import { MESSAGES_VI } from "./vi-VN";
import { MESSAGES_EN } from "./en-US";

/**
 * Supported language codes
 */
export type SupportedLocale = "vi-VN" | "en-US";

/**
 * Message dictionary mapping locale to messages
 */
const MESSAGE_MAP: Record<SupportedLocale, Record<string, any>> = {
  "vi-VN": MESSAGES_VI,
  "en-US": MESSAGES_EN,
};

/**
 * Default locale when requested locale is not found
 */
const DEFAULT_LOCALE: SupportedLocale = "vi-VN";

/**
 * Get the message dictionary for a given locale.
 * Falls back to default locale if the requested locale is not supported.
 *
 * @param locale - The locale code (e.g. "vi-VN", "en-US")
 * @returns The message dictionary for the locale
 *
 * @example
 * ```ts
 * const messages = getMessages("vi-VN");
 * console.log(messages.shortener.PASSWORD_NOT_ALLOWED);
 * // "Gói hiện tại của bạn không cho phép bảo vệ liên kết bằng mật khẩu."
 * ```
 */
export function getMessages(locale: string): Record<string, any> {
  return MESSAGE_MAP[locale as SupportedLocale] ?? MESSAGE_MAP[DEFAULT_LOCALE];
}

/**
 * Resolve a message by dot-notation key path for a given locale.
 * Supports dynamic messages via function values.
 *
 * @param locale - The locale code (e.g. "vi-VN", "en-US")
 * @param keyPath - Dot-notation path to the message (e.g. "shortener.DAILY_LIMIT_REACHED")
 * @param args - Optional arguments if the message is a function
 * @returns The resolved message string
 *
 * @example
 * ```ts
 * // Static message
 * const msg = resolveMessage("vi-VN", "shortener.PASSWORD_NOT_ALLOWED");
 *
 * // Dynamic message with parameters
 * const msg = resolveMessage("vi-VN", "shortener.DAILY_LIMIT_REACHED", 10);
 * // "Bạn đã đạt giới hạn 10 liên kết hôm nay."
 * ```
 */
export function resolveMessage(
  locale: string,
  keyPath: string,
  ...args: any[]
): string {
  const messages = getMessages(locale);
  const keys = keyPath.split(".");
  let value: any = messages;

  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) {
      // Fallback: try default locale
      if (locale !== DEFAULT_LOCALE) {
        return resolveMessage(DEFAULT_LOCALE, keyPath, ...args);
      }
      return keyPath; // Return key path as fallback
    }
  }

  if (typeof value === "function") {
    return value(...args);
  }

  return String(value);
}

export { MESSAGES_VI, MESSAGES_EN };
