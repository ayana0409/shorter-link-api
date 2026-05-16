import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Account, AccountDocument } from "../account/schemas/account.schema";
import { LoginDto } from "./dto/login.dto";
import { AccountService } from "../account/account.service";
import { JwtService } from "@nestjs/jwt/dist/jwt.service";
import * as bcrypt from "bcrypt";
import { I18nService } from "../common/i18n";
import { RedisService } from "../redis";
import { ConfigManagerService } from "../config/config-manager.service";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class AuthService {
  constructor(
    private readonly accountService: AccountService,
    private jwtService: JwtService,
    private i18n: I18nService,
    private redisService: RedisService,
    private configManager: ConfigManagerService,
  ) {}

  /**
   * Recover active sessions from existing refresh tokens on startup.
   * Called by AuthModule.onModuleInit() to rebuild auth:active_sessions ZSET
   * in case Redis data was lost (e.g., local Redis restart without persistence).
   */
  async recoverActiveSessions(): Promise<void> {
    try {
      // Find all refresh token keys: refresh:<username>:<tokenId>
      const refreshKeys = await this.redisService.keys("refresh:*");
      if (refreshKeys.length === 0) return;

      // Extract unique usernames and find the latest expiry per user
      const userTokens = new Map<string, number>();
      for (const key of refreshKeys) {
        const parts = key.split(":");
        if (parts.length >= 3) {
          const username = parts[1];
          const ttl = await this.redisService.ttl(key);
          if (ttl > 0) {
            const expiry = Date.now() + ttl * 1000;
            const existing = userTokens.get(username);
            if (!existing || expiry > existing) {
              userTokens.set(username, expiry);
            }
          }
        }
      }

      // Rebuild auth:active_sessions ZSET
      for (const [username, expiry] of userTokens) {
        await this.redisService.zadd("auth:active_sessions", expiry, username);
      }
    } catch {
      // ignore recovery errors
    }
  }

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

  async validateUser(user: LoginDto): Promise<AccountDocument | null> {
    let account: AccountDocument;
    try {
      account = await this.accountService.findOneByUsername(user.username);
    } catch {
      throw new UnauthorizedException(this.msg("auth.INVALID_CREDENTIALS"));
    }

    const isPasswordValid = await bcrypt.compare(
      user.password,
      account.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException(this.msg("auth.INVALID_CREDENTIALS"));
    }

    if (!account.isActive) {
      throw new ForbiddenException(this.msg("auth.ACCOUNT_LOCKED"));
    }

    return account;
  }

  async login(user: LoginDto) {
    if (!user) {
      throw new UnauthorizedException(this.msg("auth.INVALID_CREDENTIALS"));
    }

    const account = await this.validateUser(user);

    if (!account) {
      throw new UnauthorizedException(this.msg("auth.INVALID_CREDENTIALS"));
    }

    const payload = {
      _id: account._id,
      username: account.username,
      fullname: account.fullname,
      role: account.role,
      sub: account.username,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshTokenId = uuidv4();

    const [accessTokenTtl, refreshTokenTtl] = await Promise.all([
      this.configManager.getNumberValue("ACCESS_TOKEN_TTL", 900),
      this.configManager.getNumberValue("REFRESH_TOKEN_TTL", 604800),
    ]);

    // Store refresh token in Redis with TTL
    await this.redisService.set(
      `refresh:${account.username}:${refreshTokenId}`,
      account.username,
      { ttl: refreshTokenTtl },
    );

    // Track active session in sorted set (score = expiry timestamp)
    // Session expires when refresh token expires
    const sessionExpiry = Date.now() + refreshTokenTtl * 1000;
    await this.redisService.zadd(
      "auth:active_sessions",
      sessionExpiry,
      account.username,
    );

    return {
      access_token: accessToken,
      expires_in: accessTokenTtl,
      refresh_token: refreshTokenId,
      refresh_expires_in: refreshTokenTtl,
      user: {
        username: account.username,
        fullname: account.fullname,
        role: account.role,
      },
    };
  }

  async refreshTokens(refreshToken: string, username: string) {
    // Validate the refresh token exists in Redis
    const storedValue = await this.redisService.get(
      `refresh:${username}:${refreshToken}`,
    );

    if (!storedValue) {
      throw new UnauthorizedException(this.msg("auth.INVALID_REFRESH_TOKEN"));
    }

    // Get the account
    let account: AccountDocument;
    try {
      account = await this.accountService.findOneByUsername(username);
    } catch {
      // If account no longer exists, revoke all refresh tokens for this username
      await this.redisService.del(`refresh:${username}:${refreshToken}`);
      throw new UnauthorizedException(this.msg("auth.INVALID_REFRESH_TOKEN"));
    }

    if (!account.isActive) {
      await this.redisService.del(`refresh:${username}:${refreshToken}`);
      throw new ForbiddenException(this.msg("auth.ACCOUNT_LOCKED"));
    }

    // Token rotation: delete old refresh token, issue new one
    await this.redisService.del(`refresh:${username}:${refreshToken}`);

    const payload = {
      _id: account._id,
      username: account.username,
      fullname: account.fullname,
      role: account.role,
      sub: account.username,
    };

    const newAccessToken = this.jwtService.sign(payload);
    const newRefreshTokenId = uuidv4();

    const [accessTokenTtl, refreshTokenTtl] = await Promise.all([
      this.configManager.getNumberValue("ACCESS_TOKEN_TTL", 900),
      this.configManager.getNumberValue("REFRESH_TOKEN_TTL", 604800),
    ]);

    await this.redisService.set(
      `refresh:${account.username}:${newRefreshTokenId}`,
      account.username,
      { ttl: refreshTokenTtl },
    );

    // Update active session expiry in sorted set
    const sessionExpiry = Date.now() + refreshTokenTtl * 1000;
    await this.redisService.zadd(
      "auth:active_sessions",
      sessionExpiry,
      account.username,
    );

    return {
      access_token: newAccessToken,
      expires_in: accessTokenTtl,
      refresh_token: newRefreshTokenId,
      refresh_expires_in: refreshTokenTtl,
    };
  }

  async logout(refreshToken: string, username: string) {
    // Revoke the specific refresh token
    await this.redisService.del(`refresh:${username}:${refreshToken}`);

    // Check if user has any remaining refresh tokens
    const remainingTokens = await this.redisService.keys(
      `refresh:${username}:*`,
    );
    if (remainingTokens.length === 0) {
      // No more sessions — remove from active sessions
      await this.redisService.zrem("auth:active_sessions", username);
    }
  }

  /**
   * Get active session statistics.
   * Cleans up expired sessions (score < now) before returning.
   */
  async getActiveSessionStats(): Promise<{
    totalActiveUsers: number;
    users: string[];
  }> {
    const now = Date.now();
    // Remove expired sessions (score < now)
    await this.redisService.zremrangebyscore("auth:active_sessions", 0, now);
    // Get remaining active sessions
    const users = await this.redisService.zrange("auth:active_sessions");
    return {
      totalActiveUsers: users.length,
      users,
    };
  }
}
