# Redis Service

## Cấu trúc file

```
src/redis/
├── redis.module.ts    # Module đăng ký Redis client (Global)
├── redis.service.ts   # Service chứa toàn bộ operations
├── index.ts           # Barrel export
└── README.md          # File này
```

## Cấu hình .env

```env
REDIS_USERNAME=default
REDIS_PASSWORD=g9vUFQs8hO7ZgUSCLXrKyI2Xa91VhhEl
REDIS_HOST=throat-viable-plough-13341.db.redis.io
REDIS_PORT=13166
```

## Cách sử dụng

### 1. Basic Key-Value

```typescript
import { RedisService } from "../redis";

@Injectable()
export class MyService {
  constructor(private readonly redis: RedisService) {}

  async example() {
    // Set với TTL 5 phút
    await this.redis.set("mykey", { data: "value" }, { ttl: 300 });

    // Get (tự động parse JSON)
    const data = await this.redis.get<{ data: string }>("mykey");

    // Delete
    await this.redis.del("mykey");

    // Check exists
    const exists = await this.redis.exists("mykey");
  }
}
```

### 2. Short URL Cache

```typescript
// Cache short URL
await this.redis.cacheShortUrl("abc123", { originalUrl: "https://..." }, 3600);

// Get cached
const cached = await this.redis.getCachedShortUrl("abc123");

// Invalidate khi update/delete
await this.redis.invalidateShortUrl("abc123");
```

### 3. Config Cache

```typescript
// Cache config
await this.redis.cacheConfig("DAILY_SHORTEN_LIMIT", 10);

// Get cached
const limit = await this.redis.getCachedConfig<number>("DAILY_SHORTEN_LIMIT");

// Invalidate khi admin update
await this.redis.invalidateConfig("DAILY_SHORTEN_LIMIT");
// hoặc invalidate tất cả
await this.redis.invalidateAllConfig();
```

### 4. User Permission Cache

```typescript
// Cache permissions
await this.redis.cacheUserPermissions(userId, {
  dailyShortenLimit: 50,
  allowPassword: true,
  allowCustomExpiration: true,
});

// Get cached
const perms = await this.redis.getCachedUserPermissions(userId);

// Invalidate khi user thay đổi level
await this.redis.invalidateUserPermissions(userId);
```

### 5. Daily Counter

```typescript
// Tăng counter (TTL tự động đến 00:00)
const count = await this.redis.incrementDailyCount(userId);

// Đếm hiện tại
const current = await this.redis.getDailyCount(userId);
```

### 6. Notification Queue (Buffer cho WebSocket)

```typescript
// Khi WS chưa sẵn sàng → enqueue
const msgId = await this.redis.enqueueNotification({
  type: "link_created",
  payload: { shortUrl: "abc123", message: "Link created!" },
  targetUserId: "user123",
});

// Khi WS sẵn sàng → drain hết queue
const messages = await this.redis.drainAllNotifications();
for (const msg of messages) {
  // Gửi qua WebSocket
  this.server.to(msg.targetUserId).emit(msg.type, msg.payload);
}

// Kiểm tra còn pending không
const count = await this.redis.getPendingNotificationCount();
const hasPending = await this.redis.hasPendingNotifications();
```

### 7. Get-or-Set Pattern (Cache Aside)

```typescript
// Tự động cache nếu chưa có
const data = await this.redis.getOrSet(
  "config:DAILY_LIMIT",
  async () => {
    // Chỉ chạy nếu cache miss
    return this.configModel.findOne({ key: "DAILY_LIMIT" });
  },
  { ttl: 600 },
);
```

### 8. Hash Operations

```typescript
// Lưu object dưới dạng hash
await this.redis.hset("user:123", "name", "John");
await this.redis.hset("user:123", "email", "john@example.com");

// Get single field
const name = await this.redis.hget("user:123", "name");

// Get all fields
const user = await this.redis.hgetall("user:123");
// { name: 'John', email: 'john@example.com' }
```

### 9. Counter

```typescript
// Increment với TTL
const newVal = await this.redis.incr("counter:page_views", 3600);

// Decrement
const decrVal = await this.redis.decr("counter:page_views");
```

## Dung lượng ước tính

| Loại               | Dung lượng          |
| ------------------ | ------------------- |
| Short URL cache    | ~5 MB               |
| User permissions   | ~300 KB             |
| Config cache       | ~2 KB               |
| Daily counters     | ~25 KB              |
| Notification queue | ~70 KB              |
| Redis overhead     | ~3 MB               |
| **Tổng**           | **~8.5 MB / 30 MB** |

## Key Naming Convention

| Prefix                | Mục đích                 | TTL           |
| --------------------- | ------------------------ | ------------- |
| `shorturl:*`          | Short URL → Original URL | 1 giờ         |
| `config:*`            | System config            | 10 phút       |
| `user:perm:*`         | User permissions         | 5 phút        |
| `daily_count:*`       | Daily counters           | Đến 00:00     |
| `notification_queue`  | Notification buffer      | Không expire  |
| `notification_status` | Message status           | Cleanup 1 giờ |
