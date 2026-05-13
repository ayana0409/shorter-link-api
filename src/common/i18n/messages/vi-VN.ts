/**
 * Vietnamese (vi-VN) messages for the application
 * Organized by module for easy maintenance and reuse
 */

export const MESSAGES_VI = {
  // ==================== SHORTENER MODULE ====================
  shortener: {
    // Creation errors
    PASSWORD_NOT_ALLOWED:
      "Gói hiện tại của bạn không cho phép bảo vệ liên kết bằng mật khẩu.",
    CUSTOM_EXPIRATION_NOT_ALLOWED:
      "Gói hiện tại của bạn không cho phép đặt ngày hết hạn tùy chỉnh cho liên kết.",
    DAILY_LIMIT_REACHED: (limit: number) =>
      `Bạn đã đạt giới hạn ${limit} liên kết hôm nay.`,
    DAILY_LIMIT_REACHED_TRY_TOMORROW: (limit: number) =>
      `Bạn đã đạt giới hạn ${limit} liên kết hôm nay. Vui lòng thử lại vào ngày mai.`,

    // Validation errors
    SHORT_LINK_NOT_FOUND_OR_EXPIRED:
      "Liên kết rút gón không tìm thấy hoặc đã hết hạn.",
    PASSWORD_REQUIRED: "Vui lòng nhập mật khẩu để truy cập liên kết này.",
    PASSWORD_INCORRECT: "Mật khẩu không đúng.",

    // Analytics errors
    INVALID_FROM_DATE: "Ngày bắt đầu không hợp lệ.",
    INVALID_TO_DATE: "Ngày kết thúc không hợp lệ.",
  },

  // ==================== COMMON / GENERAL ====================
  common: {
    NOT_FOUND: "Không tìm thấy tài nguyên.",
    UNAUTHORIZED: "Bạn không có quyền truy cập.",
    FORBIDDEN: "Truy cập bị từ chối.",
    INTERNAL_ERROR: "Đã xảy ra lỗi nội bộ. Vui lòng thử lại sau.",
    BAD_REQUEST: "Yêu cầu không hợp lệ.",
  },
} as const;
