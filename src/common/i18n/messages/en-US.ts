/**
 * English (en-US) messages for the application
 * Organized by module for easy maintenance and reuse
 */

export const MESSAGES_EN = {
  // ==================== SHORTENER MODULE ====================
  shortener: {
    // Creation errors
    PASSWORD_NOT_ALLOWED:
      "Your current level does not allow password protection for links.",
    CUSTOM_EXPIRATION_NOT_ALLOWED:
      "Your current level does not allow custom expiration dates for links.",
    DAILY_LIMIT_REACHED: (limit: number) =>
      `You have reached the daily limit of ${limit} links.`,
    DAILY_LIMIT_REACHED_TRY_TOMORROW: (limit: number) =>
      `You have reached the daily limit of ${limit} links. Please try again tomorrow.`,

    // Validation errors
    SHORT_LINK_NOT_FOUND_OR_EXPIRED: "Short link not found or expired.",
    PASSWORD_REQUIRED: "Please enter the password to access this link.",
    PASSWORD_INCORRECT: "Incorrect password.",

    // Analytics errors
    INVALID_FROM_DATE: "Invalid from date.",
    INVALID_TO_DATE: "Invalid to date.",
  },

  // ==================== COMMON / GENERAL ====================
  common: {
    NOT_FOUND: "Resource not found.",
    UNAUTHORIZED: "You are not authorized to access this resource.",
    FORBIDDEN: "Access denied.",
    INTERNAL_ERROR: "An internal error occurred. Please try again later.",
    BAD_REQUEST: "Bad request.",
  },
} as const;
