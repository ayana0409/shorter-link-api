import { Injectable } from "@nestjs/common";
import { getMessages, resolveMessage, SupportedLocale } from "./messages";

/**
 * Internationalization service for resolving localized messages.
 * Messages are cached in memory after first load (rarely change at runtime).
 */
@Injectable()
export class I18nService {
  private readonly messageCache = new Map<string, Record<string, any>>();

  /**
   * Default locale used when no locale is specified
   */
  readonly defaultLocale: SupportedLocale = "vi-VN";

  /**
   * Get the full message dictionary for a locale (cached in memory)
   */
  getMessages(locale: string): Record<string, any> {
    if (this.messageCache.has(locale)) {
      return this.messageCache.get(locale)!;
    }
    const messages = getMessages(locale);
    this.messageCache.set(locale, messages);
    return messages;
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

  /**
   * Clear the message cache (useful after deploying new translations)
   */
  clearCache(): void {
    this.messageCache.clear();
  }
}
