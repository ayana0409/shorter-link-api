import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { I18nService } from "../common/i18n";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private i18n: I18nService) {}

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || user.role !== "admin") {
      throw new ForbiddenException(this.msg("auth.ADMIN_ACCESS_REQUIRED"));
    }

    return true;
  }
}
