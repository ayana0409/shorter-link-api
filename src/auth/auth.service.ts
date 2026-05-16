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

    // Track active session
    await this.redisService.sadd("active_sessions", account.username);

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

    // Ensure user stays in active sessions
    await this.redisService.sadd("active_sessions", account.username);

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
      await this.redisService.srem("active_sessions", username);
    }
  }

  /**
   * Get active session statistics
   */
  async getActiveSessionStats(): Promise<{
    totalActiveUsers: number;
    users: string[];
  }> {
    const users = await this.redisService.smembers("active_sessions");
    return {
      totalActiveUsers: users.length,
      users,
    };
  }
}
