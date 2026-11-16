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

  // ==================== ACCOUNT MODULE ====================
  account: {
    // Creation errors
    USERNAME_ALREADY_EXISTS: (username: string) =>
      `Account with username ${username} already exists.`,
    USER_NOT_FOUND: (id: string) => `Account with ID ${id} not found.`,
    USERNAME_NOT_FOUND: (username: string) =>
      `Account with username ${username} not found.`,

    // Access control
    ACCESS_DENIED_USER_ONLY: "You can only access user accounts.",
    UPDATE_DENIED_USER_ONLY: "You can only update user accounts.",
    CANNOT_CHANGE_ROLE: "Managers cannot change user roles.",

    // Validation
    PASSWORD_REQUIRED: "Password is required.",
    INVALID_PASSWORD: "Invalid password.",
  },

  // ==================== LEVEL MODULE ====================
  level: {
    NOT_FOUND: (id: string) => `Level with ID ${id} not found.`,
  },

  // ==================== AUDIT LOG MODULE ====================
  auditLog: {
    INVALID_FROM_DATE: "Invalid from date.",
    INVALID_TO_DATE: "Invalid to date.",
  },

  // ==================== AUTH MODULE ====================
  auth: {
    INVALID_CREDENTIALS: "Invalid username or password.",
    ACCOUNT_LOCKED: "Account has been permanently locked.",
    ADMIN_ACCESS_REQUIRED: "Admin access required.",
    MANAGER_ACCESS_REQUIRED: "Admin or Manager access required.",
    TOKEN_REQUIRED: "Authentication required. Please provide a token.",
    INVALID_REFRESH_TOKEN: "Session has expired. Please log in again.",
    SESSION_EXPIRED: "Your session has expired. Please log in again.",
  },

  // ==================== CONFIG MODULE ====================
  config: {
    KEY_NOT_FOUND: (key: string) => `Config key "${key}" not found.`,
    KEY_NOT_ALLOWED: (key: string, allowed: string) =>
      `Cannot update config key "${key}". Allowed keys: ${allowed}.`,
    INVALID_NUMBER_VALUE: (key: string) =>
      `Value must be a valid number for key "${key}".`,
  },

  // ==================== GROUP MODULE ====================
  group: {
    NOT_FOUND: "Group not found.",
    ACCESS_DENIED: "You do not have permission to access this group.",
    ONLY_OWNER_UPDATE: "Only the owner can update the group name.",
    ONLY_OWNER_DELETE: "Only the owner can delete the group.",
    ONLY_OWNER_OR_MANAGER_ADD:
      "Only the owner or a group manager can add members.",
    MANAGER_CAN_ONLY_ADD_MEMBER:
      "Group managers can only add members, not managers.",
    ONLY_OWNER_CHANGE_ROLE: "Only the owner can change member roles.",
    ONLY_OWNER_OR_MANAGER_REMOVE:
      "Only the owner or a group manager can remove members.",
    CANNOT_REMOVE_OWNER: "Cannot remove the group owner.",
    MEMBER_NOT_FOUND: "Group member not found.",
    MANAGER_CAN_ONLY_REMOVE_MEMBER:
      "Group managers can only remove members, not managers.",
    ONLY_OWNER_OR_MANAGER_REMOVE_LINK:
      "Only the owner or a group manager can remove links from the group.",
    MAX_GROUPS_REACHED: (limit: number) =>
      `You have reached the maximum group limit: (${limit}).`,
    MAX_MEMBERS_REACHED: (limit: number) => `Group member limit is (${limit}).`,
    MAX_LINKS_REACHED: (current: number, limit: number) =>
      `Group already has ${current} links. Maximum limit is ${limit} links/group.`,
    ACCOUNT_NOT_FOUND: (identifier: string) =>
      `Account with id or username '${identifier}' not found.`,
    ACCOUNT_NOT_FOUND_BY_USERNAME: (username: string) =>
      `Account with username '${username}' not found.`,
    INVITATION_NOT_FOUND: "Group invitation not found or no longer valid.",
    ALREADY_INVITED:
      "This account has already been invited and is pending confirmation.",
    ALREADY_MEMBER: "This account is already a member of the group.",
    CANNOT_INVITE_SELF: "You cannot invite yourself to the group.",
    ONLY_OWNER_OR_MANAGER_CANCEL_INVITE:
      "Only the owner or a group manager can cancel invitations.",
    INVITATION_CANCELLED_SUCCESS: "Group invitation cancelled successfully.",
    OWNER_CANNOT_LEAVE:
      "The group owner cannot leave the group. Please transfer ownership or delete the group.",
    NOT_A_MEMBER: "You are not a member of this group.",
    LEAVE_GROUP_SUCCESS: "You have left the group successfully.",
    MEMBER_LEFT_NOTIFICATION: (name: string, groupName: string) =>
      `${name} has left the group "${groupName}".`,
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
