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

  // ==================== ACCOUNT MODULE ====================
  account: {
    // Creation errors
    USERNAME_ALREADY_EXISTS: (username: string) =>
      `Tài khoản với tên đăng nhập ${username} đã tồn tại.`,
    USER_NOT_FOUND: (id: string) => `Không tìm thấy tài khoản với ID ${id}.`,
    USERNAME_NOT_FOUND: (username: string) =>
      `Không tìm thấy tài khoản với tên đăng nhập ${username}.`,

    // Access control
    ACCESS_DENIED_USER_ONLY: "Bạn chỉ có thể truy cập tài khoản người dùng.",
    UPDATE_DENIED_USER_ONLY: "Bạn chỉ có thể cập nhật tài khoản người dùng.",
    CANNOT_CHANGE_ROLE: "Quản lý không thể thay đổi vai trò người dùng.",

    // Validation
    PASSWORD_REQUIRED: "Mật khẩu là bắt buộc.",
    INVALID_PASSWORD: "Mật khẩu không đúng.",
  },

  // ==================== LEVEL MODULE ====================
  level: {
    NOT_FOUND: (id: string) => `Không tìm thấy gói với ID ${id}.`,
  },

  // ==================== AUDIT LOG MODULE ====================
  auditLog: {
    INVALID_FROM_DATE: "Ngày bắt đầu không hợp lệ.",
    INVALID_TO_DATE: "Ngày kết thúc không hợp lệ.",
  },

  // ==================== AUTH MODULE ====================
  auth: {
    INVALID_CREDENTIALS: "Tên đăng nhập hoặc mật khẩu không đúng.",
    ACCOUNT_LOCKED: "Tài khoản đã bị khóa vĩnh viễn.",
    ADMIN_ACCESS_REQUIRED: "Yêu cầu quyền truy cập Admin.",
    MANAGER_ACCESS_REQUIRED: "Yêu cầu quyền truy cập Admin hoặc Manager.",
    TOKEN_REQUIRED: "Yêu cầu xác thực. Vui lòng cung cấp token.",
    INVALID_REFRESH_TOKEN:
      "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
    SESSION_EXPIRED: "Phiên của bạn đã hết hạn. Vui lòng đăng nhập lại.",
  },

  // ==================== CONFIG MODULE ====================
  config: {
    KEY_NOT_FOUND: (key: string) =>
      `Không tìm thấy cấu hình với khóa "${key}".`,
    KEY_NOT_ALLOWED: (key: string, allowed: string) =>
      `Không thể cập nhật cấu hình "${key}". Các khóa được phép: ${allowed}.`,
    INVALID_NUMBER_VALUE: (key: string) =>
      `Giá trị phải là một số hợp lệ cho khóa "${key}".`,
  },

  // ==================== GROUP MODULE ====================
  group: {
    NOT_FOUND: "Không tìm thấy nhóm.",
    ACCESS_DENIED: "Bạn không có quyền truy cập nhóm này.",
    ONLY_OWNER_UPDATE: "Chỉ chủ sở hữu mới có thể cập nhật tên nhóm.",
    ONLY_OWNER_DELETE: "Chỉ chủ sở hữu mới có thể xóa nhóm.",
    ONLY_OWNER_OR_MANAGER_ADD:
      "Chỉ chủ sở hữu hoặc quản lý nhóm mới có thể thêm thành viên.",
    MANAGER_CAN_ONLY_ADD_MEMBER:
      "Quản lý nhóm chỉ có thể thêm thành viên thường, không thể thêm quản lý.",
    ONLY_OWNER_CHANGE_ROLE:
      "Chỉ chủ sở hữu mới có thể thay đổi vai trò thành viên.",
    ONLY_OWNER_OR_MANAGER_REMOVE:
      "Chỉ chủ sở hữu hoặc quản lý nhóm mới có thể xóa thành viên.",
    CANNOT_REMOVE_OWNER: "Không thể xóa chủ sở hữu nhóm.",
    MEMBER_NOT_FOUND: "Không tìm thấy thành viên nhóm.",
    MANAGER_CAN_ONLY_REMOVE_MEMBER:
      "Quản lý nhóm chỉ có thể xóa thành viên thường, không thể xóa quản lý.",
    ONLY_OWNER_OR_MANAGER_REMOVE_LINK:
      "Chỉ chủ sở hữu hoặc quản lý nhóm mới có thể xóa liên kết khỏi nhóm.",
    MAX_GROUPS_REACHED: (limit: number) =>
      `Bạn đã đạt giới hạn nhóm tối đa: (${limit}).`,
    MAX_MEMBERS_REACHED: (limit: number) =>
      `Giới hạn thành viên nhóm là (${limit}).`,
    MAX_LINKS_REACHED: (current: number, limit: number) =>
      `Nhóm đã có ${current} liên kết. Giới hạn tối đa là ${limit} liên kết/nhóm.`,
    ACCOUNT_NOT_FOUND: (identifier: string) =>
      `Không tìm thấy tài khoản với tên đăng nhập hoặc ID '${identifier}'.`,
    ACCOUNT_NOT_FOUND_BY_USERNAME: (username: string) =>
      `Không tìm thấy tài khoản với tên đăng nhập '${username}'.`,
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
