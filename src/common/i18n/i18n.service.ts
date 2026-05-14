import { Injectable } from "@nestjs/common";
import { getMessages, resolveMessage, SupportedLocale } from "./messages";

/**
 * Internationalization service for resolving localized messages.
 *
 * Usage in other services:
 * ```ts
 * constructor(private i18n: I18nService) {}
 *
 * // Resolve with explicit locale
 * const msg = this.i18n.t("vi-VN", "shortener.PASSWORD_NOT_ALLOWED");
 *
 * // Resolve with dynamic params
 * const msg = this.i18n.t("vi-VN", "shortener.DAILY_LIMIT_REACHED", 10);
 * ```
 */
@Injectable()
export class I18nService {
  /**
   * Default locale used when no locale is specified
   */
  readonly defaultLocale: SupportedLocale = "vi-VN";

  /**
   * Get the full message dictionary for a locale
   */
  getMessages(locale: string): Record<string, any> {
    return getMessages(locale);
  }

  /**
   * Resolve a localized message by key path
   *
   * @param locale - Locale code (e.g. "vi-VN", "en-US")
   * @param keyPath - Dot-notation key (e.g. "shortener.DAILY_LIMIT_REACHED")
   * @param args - Optional arguments for dynamic messages
   */
  t(locale: string, keyPath: string, ...args: any[]): string {
    return resolveMessage(locale, keyPath, ...args);
  }
}
