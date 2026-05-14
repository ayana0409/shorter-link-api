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

@Injectable()
export class AuthService {
  constructor(
    private readonly accountService: AccountService,
    private jwtService: JwtService,
    private i18n: I18nService,
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
    const token = this.jwtService.sign(payload);

    return {
      access_token: token,
      expires_in: 3600,
      user: {
        username: account.username,
        fullname: account.fullname,
        role: account.role,
      },
    };
  }
}
