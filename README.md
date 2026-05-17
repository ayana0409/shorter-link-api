# 🔗 Shorter Link — Backend

> REST API cho hệ thống rút gọn URL (URL Shortener), xây dựng trên NestJS với MongoDB, Redis, JWT authentication, phân quyền RBAC, audit log và đa ngôn ngữ.

---

## 📋 Mục lục

- [Tổng quan](#-tổng-quan)
- [Kiến trúc](#-kiến-trúc)
- [Công nghệ sử dụng](#-công-nghệ-sử-dụng)
- [Chức năng](#-chức-năng)
- [API Endpoints](#-api-endpoints)

---

## 🔭 Tổng quan

**Shorter Link Backend** là REST API chính của hệ thống rút gọn URL, được xây dựng trên **NestJS** với kiến trúc module hóa. Hệ thống hỗ trợ:

- **Xác thực JWT** với refresh token rotation (HttpOnly Cookie + Redis)
- **Phân quyền RBAC** 3 cấp: `user` → `manager` → `admin`
- **Hệ thống cấp độ** (Level) với giới hạn chức năng theo từng bậc
- **Quản lý nhóm** với phân vai trò thành viên
- **Audit log** tự động ghi nhận mọi thao tác
- **Cấu hình động** từ database (không cần restart)
- **Đa ngôn ngữ** (i18n) Tiếng Việt / Tiếng Anh
- **Rate limiting** và **security headers** (Helmet)
- **Redis cache** cho session, daily count, rate limiting

---

## 🏗 Kiến trúc

```
shorter-link-backend/
├── src/
│   ├── account/            # Quản lý tài khoản & cấp độ (Level)
│   │   ├── dto/            # Data Transfer Objects
│   │   └── schemas/        # Mongoose schemas (Account, Level)
│   ├── audit-log/          # Nhật ký audit
│   │   └── schemas/        # AuditLog schema
│   ├── auth/               # Xác thực & phân quyền
│   │   ├── dto/            # Login, RefreshToken DTOs
│   │   ├── auth.guard.ts   # JWT authentication guard
│   │   ├── admin.guard.ts  # Admin role guard
│   │   └── manager.guard.ts# Manager/Admin role guard
│   ├── common/             # Tiện ích dùng chung
│   │   ├── pagination.ts   # Generic pagination helpers
│   │   ├── filters/        # Global exception filter
│   │   ├── i18n/           # Đa ngôn ngữ (VI/EN)
│   │   └── interfaces/     # TypeScript interfaces
│   ├── config/             # Cấu hình hệ thống động
│   │   ├── dto/            # UpdateConfig DTO
│   │   └── schemas/        # Config schema
│   ├── database/           # Module kết nối MongoDB
│   ├── group/              # Quản lý nhóm
│   │   ├── dto/            # Group DTOs
│   │   └── schemas/        # Group schema
│   ├── notification/       # Hệ thống thông báo
│   │   └── schemas/        # Notification schema
│   ├── redis/              # Redis service (cache, session, rate limit)
│   ├── shortener/          # Core: Rút gọn URL
│   │   ├── dto/            # Create/Update Shortener DTOs
│   │   └── schema/         # Shortener schema
│   ├── app.module.ts       # Root module
│   ├── app.controller.ts   # Health check endpoint
│   └── main.ts             # Bootstrap & middleware setup
├── Dockerfile              # Multi-stage Docker build
├── docker-compose.yml      # MongoDB + Redis local
└── render.yaml             # Render.com deployment config
```

### Luồng xác thực

```
Client Request
    → Helmet + CookieParser + CORS
    → AuthGuard (verify JWT, check active account)
    → Role Guard (AdminGuard / ManagerGuard — tùy endpoint)
    → Controller → Service → MongoDB / Redis
    → LoggingInterceptor (ghi audit log cho POST/PUT/PATCH/DELETE)
    → AllExceptionsFilter (bắt & log lỗi, ghi audit log error)
```

---

## 🛠 Công nghệ sử dụng

| Công nghệ           | Phiên bản           | Mô tả                                |
| ------------------- | ------------------- | ------------------------------------ |
| **NestJS**          | ^11.0.1             | Framework Node.js chính              |
| **TypeScript**      | ^5.7.3              | Ngôn ngữ lập trình                   |
| **MongoDB**         | via Mongoose ^8.9.6 | Cơ sở dữ liệu NoSQL                  |
| **Mongoose**        | ^11.0.1             | ODM cho MongoDB                      |
| **Redis**           | ^5.12.1             | Cache, session store, rate limiting  |
| **Passport + JWT**  | ^0.7.0 / ^4.0.1     | Xác thực token                       |
| **bcrypt**          | ^5.1.1              | Mã hóa mật khẩu                      |
| **class-validator** | ^0.14.1             | Validation DTO                       |
| **Helmet**          | ^8.1.0              | Security headers                     |
| **Throttler**       | ^6.5.0              | Rate limiting                        |
| **Axios**           | ^1.15.0             | HTTP client (fetch page title)       |
| **Cheerio**         | ^1.2.0              | HTML parser                          |
| **i18n**            | Custom              | Đa ngôn ngữ (Tiếng Việt / Tiếng Anh) |
| **Jest**            | ^29.7.0             | Unit testing                         |
| **Supertest**       | ^7.0.0              | E2E testing                          |
| **ESLint**          | ^9.18.0             | Linting                              |
| **Docker**          | node:20-slim        | Containerization                     |

### Kỹ thuật & Patterns

- **Multi-stage Docker build** — Giảm kích thước image production
- **Repository Pattern** — Mongoose models với Dependency Injection
- **Guard-based Authorization** — `AuthGuard`, `AdminGuard`, `ManagerGuard`
- **Global Exception Filter** — Bắt và log tất cả exceptions, tự động ghi audit log error
- **Logging Interceptor** — Ghi audit log tự động cho mọi mutation request (POST/PUT/PATCH/DELETE)
- **Redis Cache** — Cache daily count, session management, rate limiting
- **Infinite Retry** — Tự động reconnect MongoDB khi mất kết nối (không crash app)
- **Refresh Token Rotation** — HttpOnly cookie với rotation khi refresh, lưu trong Redis
- **Pagination Helper** — Generic `buildSearchQuery`, `buildSort`, `paginateModel` cho tất cả collections
- **i18n** — Hệ thống đa ngôn ngữ (VI/EN) với message key resolution
- **Role-based Access Control (RBAC)** — 3 vai trò: `user`, `manager`, `admin`
- **Dynamic Config** — Cấu hình runtime từ database, không cần restart

---

## 📦 Chức năng

### 🔐 Xác thực & Phân quyền

- **Đăng ký / Đăng nhập** tài khoản
- **JWT Access Token** (short-lived) + **Refresh Token** (HttpOnly Cookie, Redis-backed)
- **Refresh Token Rotation** — Token mới được cấp khi refresh
- **Đăng xuất** — Xóa refresh token khỏi Redis
- **Phân quyền 3 cấp**: `user` → `manager` → `admin`
- **Khóa/Mở khóa** tài khoản (Admin)
- **Auto tạo tài khoản admin** mặc định khi khởi động
- **Xem active sessions** (Admin)

### 🔗 Rút gọn URL (Core Feature)

- Tạo link rút gọn từ URL gốc
- **Tự động lấy tiêu đề trang web** (site name) bằng Cheerio
- **Giới hạn số link tạo theo ngày** dựa trên cấp độ người dùng
- **Bảo vệ bằng mật khẩu** (tùy chọn, phụ thuộc level)
- **Thời hạn hiệu lực** — Ngày bắt đầu / ngày hết hạn (tùy chọn)
- **Link vô thời hạn** (tùy chọn, phụ thuộc level)
- **Đếm số lượt click** mỗi link
- **Tìm kiếm & lọc** link theo trạng thái (valid/expired/disabled)
- **Phân trang** kết quả
- **Xem thống kê** tạo link theo ngày/tuần/tháng (analytics)
- **Cache daily count** trong Redis
- **Redirect** từ short URL → original URL (với kiểm tra mật khẩu & hạn sử dụng)

### 👥 Quản lý Nhóm (Groups)

- Tạo / Sửa / Xóa nhóm
- **Thêm/Xóa thành viên** với vai trò: `owner`, `manager`, `member`
- **Thêm/Xóa link** vào nhóm
- Xem danh sách thành viên và link trong nhóm
- Giới hạn số nhóm, thành viên, link theo level

### 📊 Quản lý Cấp độ (Levels)

- Tạo / Sửa / Xóa cấp độ người dùng
- Cấu hình cho mỗi level:
  - **Giá** (price)
  - **Giới hạn link/ngày** (dailyShortenLimit)
  - **Cho phép đặt mật khẩu** (allowPassword)
  - **Cho phép thời hạn tùy chỉnh** (allowCustomExpiration)
  - **Giới hạn số nhóm** (maxGroupsCount)
  - **Giới hạn thành viên/nhóm** (maxMembersPerGroup)
  - **Giới hạn link/nhóm** (maxLinksPerGroup)
- **Tự động kiểm tra hết hạn level** khi tạo link

### 🔔 Thông báo

- **Gửi thông báo** đến người dùng cụ thể (Admin)
- **Broadcast** thông báo đến tất cả người dùng
- **Lịch sử thông báo** với phân trang
- **Đánh dấu đã đọc**
- **Trạng thái**: pending → delivered / failed
- **Retry** khi gửi thất bại

### 📝 Audit Log

- Ghi nhận tất cả thao tác **create / update / delete / error**
- Lưu thông tin: người thực hiện, entity, method, URL, request body, error
- **Xem & xóa** log (Admin)
- **Tự động log** qua LoggingInterceptor và AllExceptionsFilter

### ⚙️ Cấu hình Hệ thống (Dynamic Config)

- Quản lý cấu hình runtime từ database
- Các cấu hình:
  - `DAILY_SHORTEN_LIMIT` — Giới hạn link/ngày mặc định
  - `SHORT_URL_LENGTH` — Độ dài URL rút gọn
  - `SHORT_URL_EXPIRATION_DAYS` — Thời hạn mặc định
  - `RATE_LIMIT_TTL` / `RATE_LIMIT_MAX` — Rate limiting
  - `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` — Token expiry
  - `MAX_GROUPS_COUNT` / `MAX_MEMBERS_PER_GROUP` / `MAX_LINKS_PER_GROUP`
  - Redis connection settings
  - MongoDB connection string
  - WebSocket URL

---

## 🔌 API Endpoints

### Auth (`/auth`)

| Method | Endpoint               | Mô tả               | Quyền         |
| ------ | ---------------------- | ------------------- | ------------- |
| POST   | `/auth/login`          | Đăng nhập           | Public        |
| POST   | `/auth/refresh`        | Refresh token       | Public        |
| POST   | `/auth/logout`         | Đăng xuất           | Authenticated |
| GET    | `/auth/stats/sessions` | Xem active sessions | Admin         |

### Account (`/account`)

| Method | Endpoint                    | Mô tả                      | Quyền         |
| ------ | --------------------------- | -------------------------- | ------------- |
| POST   | `/account`                  | Tạo tài khoản (Admin)      | Admin         |
| POST   | `/account/register`         | Đăng ký                    | Public        |
| GET    | `/account/admin`            | Danh sách tài khoản        | Manager+      |
| GET    | `/account/admin/:id`        | Chi tiết tài khoản + links | Manager+      |
| GET    | `/account/admin/:id/groups` | Nhóm của tài khoản         | Manager+      |
| GET    | `/account/limits`           | Giới hạn của user hiện tại | Authenticated |
| PATCH  | `/account/:id/active`       | Khóa/Mở khóa tài khoản     | Admin         |
| DELETE | `/account/:id`              | Xóa tài khoản              | Admin         |
| PATCH  | `/account/:id`              | Cập nhật tài khoản         | Manager+      |

### Level (`/level`)

| Method | Endpoint     | Mô tả           | Quyền    |
| ------ | ------------ | --------------- | -------- |
| POST   | `/level`     | Tạo level       | Admin    |
| GET    | `/level`     | Danh sách level | Manager+ |
| GET    | `/level/:id` | Chi tiết level  | Admin    |
| PATCH  | `/level/:id` | Cập nhật level  | Admin    |
| DELETE | `/level/:id` | Xóa level       | Admin    |

### Shortener (`/shortener`)

| Method | Endpoint                     | Mô tả                   | Quyền         |
| ------ | ---------------------------- | ----------------------- | ------------- |
| POST   | `/shortener`                 | Tạo link rút gọn        | Authenticated |
| GET    | `/shortener`                 | Danh sách tất cả link   | Public        |
| GET    | `/shortener/user`            | Link của user hiện tại  | Authenticated |
| GET    | `/shortener/quota`           | Xem quota còn lại       | Authenticated |
| GET    | `/shortener/analytics`       | Thống kê link (user)    | Authenticated |
| GET    | `/shortener/analytics/admin` | Thống kê link (toàn bộ) | Admin         |
| GET    | `/shortener/:shortUrl`       | Xem chi tiết link       | Public        |
| POST   | `/shortener/:shortUrl/click` | Validate & tăng click   | Public        |
| PATCH  | `/shortener/:id`             | Cập nhật link           | Public        |
| DELETE | `/shortener/:id`             | Xóa link                | Public        |

### Group (`/groups`)

| Method | Endpoint                        | Mô tả                   | Quyền         |
| ------ | ------------------------------- | ----------------------- | ------------- |
| POST   | `/groups`                       | Tạo nhóm                | Authenticated |
| GET    | `/groups`                       | Danh sách nhóm của user | Authenticated |
| GET    | `/groups/:id`                   | Chi tiết nhóm           | Authenticated |
| PUT    | `/groups/:id`                   | Cập nhật nhóm           | Authenticated |
| PATCH  | `/groups/:id`                   | Cập nhật một phần       | Authenticated |
| DELETE | `/groups/:id`                   | Xóa nhóm                | Authenticated |
| POST   | `/groups/:id/members`           | Thêm thành viên         | Authenticated |
| GET    | `/groups/:id/members`           | Danh sách thành viên    | Authenticated |
| DELETE | `/groups/:id/members/:memberId` | Xóa thành viên          | Authenticated |
| POST   | `/groups/:id/links`             | Thêm link vào nhóm      | Authenticated |
| DELETE | `/groups/:id/links/:linkId`     | Xóa link khỏi nhóm      | Authenticated |

### Notification (`/notifications`)

| Method | Endpoint                      | Mô tả             | Quyền         |
| ------ | ----------------------------- | ----------------- | ------------- |
| GET    | `/notifications/pending`      | Thông báo chờ     | Authenticated |
| GET    | `/notifications/history`      | Lịch sử thông báo | Authenticated |
| POST   | `/notifications/send`         | Gửi thông báo     | Admin         |
| POST   | `/notifications/broadcast`    | Broadcast         | Admin         |
| POST   | `/notifications/mark-as-read` | Đánh dấu đã đọc   | Authenticated |

### Audit Log (`/audit`)

| Method | Endpoint       | Mô tả                         | Quyền |
| ------ | -------------- | ----------------------------- | ----- |
| GET    | `/audit/admin` | Xem audit logs                | Admin |
| DELETE | `/audit/admin` | Xóa audit logs theo điều kiện | Admin |

### Config (`/config`)

| Method | Endpoint       | Mô tả               | Quyền |
| ------ | -------------- | ------------------- | ----- |
| GET    | `/config`      | Xem tất cả config   | Admin |
| GET    | `/config/:key` | Xem config theo key | Admin |
| PATCH  | `/config/:key` | Cập nhật config     | Admin |

### Health Check

| Method | Endpoint | Mô tả                  | Quyền  |
| ------ | -------- | ---------------------- | ------ |
| GET    | `/ping`  | Kiểm tra API đang chạy | Public |

---

## � Related Repositories

| Repository                 | Mô tả                                  | Link                                                |
| -------------------------- | -------------------------------------- | --------------------------------------------------- |
| **shorter-link-api**       | Backend REST API (NestJS)              | https://github.com/ayana0409/shorter-link-api       |
| **shorter-link-fe**        | Frontend (ReactJS)                     | https://github.com/ayana0409/shorter-link-fe        |
| **shorter-link-websocket** | WebSocket service (NestJS + Socket.IO) | https://github.com/ayana0409/shorter-link-websocket |

---

## 📄 License

UNLICENSED — Private project.
