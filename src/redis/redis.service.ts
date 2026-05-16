import { Injectable, Logger } from "@nestjs/common";
import { RedisClientType } from "redis";

export interface CacheOptions {
  ttl?: number; // TTL in seconds, undefined = no expiry
}

export interface QueueMessage {
  id: string;
  type: string;
  payload: any;
  targetUserId?: string;
  targetRoom?: string;
  createdAt: number;
  status: "pending" | "delivered" | "failed";
}

@Injectable()
export class RedisService {
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly client: RedisClientType) {}

  // ─── Connection ───────────────────────────────────────────

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === "PONG";
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
    } catch (err) {
      this.logger.error("Error disconnecting Redis:", err);
    }
  }

  // ─── Basic Key-Value ──────────────────────────────────────

  async get<T = string>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch (err) {
      this.logger.error(`Redis GET error [${key}]:`, err);
      return null;
    }
  }

  async set(key: string, value: any, options?: CacheOptions): Promise<boolean> {
    try {
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      if (options?.ttl) {
        await this.client.setEx(key, options.ttl, serialized);
      } else {
        await this.client.set(key, serialized);
      }
      return true;
    } catch (err) {
      this.logger.error(`Redis SET error [${key}]:`, err);
      return false;
    }
  }

  async del(key: string): Promise<boolean> {
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      this.logger.error(`Redis DEL error [${key}]:`, err);
      return false;
    }
  }

  async delMany(...keys: string[]): Promise<boolean> {
    try {
      await this.client.del(keys);
      return true;
    } catch (err) {
      this.logger.error(`Redis DEL error:`, err);
      return false;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch {
      return false;
    }
  }

  async expire(key: string, ttlSeconds: number): Promise<boolean> {
    try {
      const result = await this.client.expire(key, ttlSeconds);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch {
      return -2;
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      return await this.client.keys(pattern);
    } catch {
      return [];
    }
  }

  // ─── Counter ──────────────────────────────────────────────

  async incr(key: string, ttl?: number): Promise<number | null> {
    try {
      const result = await this.client.incr(key);
      if (ttl) {
        await this.client.expire(key, ttl);
      }
      return result;
    } catch (err) {
      this.logger.error(`Redis INCR error [${key}]:`, err);
      return null;
    }
  }

  async decr(key: string): Promise<number | null> {
    try {
      return await this.client.decr(key);
    } catch (err) {
      this.logger.error(`Redis DECR error [${key}]:`, err);
      return null;
    }
  }

  // ─── Hash Operations ──────────────────────────────────────

  async hget<T = any>(hash: string, field: string): Promise<T | null> {
    try {
      const value = await this.client.hGet(hash, field);
      if (value === undefined || value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch {
      return null;
    }
  }

  async hset(hash: string, field: string, value: any): Promise<boolean> {
    try {
      const serialized =
        typeof value === "string" ? value : JSON.stringify(value);
      await this.client.hSet(hash, field, serialized);
      return true;
    } catch {
      return false;
    }
  }

  async hdel(hash: string, ...fields: string[]): Promise<boolean> {
    try {
      await this.client.hDel(hash, fields);
      return true;
    } catch {
      return false;
    }
  }

  async hgetall<T = Record<string, any>>(hash: string): Promise<T> {
    try {
      const result = await this.client.hGetAll(hash);
      const parsed: Record<string, any> = {};
      for (const [key, value] of Object.entries(result)) {
        try {
          parsed[key] = JSON.parse(value);
        } catch {
          parsed[key] = value;
        }
      }
      return parsed as T;
    } catch {
      return {} as T;
    }
  }

  async hincrby(
    hash: string,
    field: string,
    increment: number,
  ): Promise<number | null> {
    try {
      return await this.client.hIncrBy(hash, field, increment);
    } catch {
      return null;
    }
  }

  // ─── Set Operations (for active session tracking) ────────

  /** Add member to set */
  async sadd(key: string, ...members: string[]): Promise<number | null> {
    try {
      return await this.client.sAdd(key, members);
    } catch (err) {
      this.logger.error(`Redis SADD error [${key}]:`, err);
      return null;
    }
  }

  /** Remove member from set */
  async srem(key: string, ...members: string[]): Promise<number | null> {
    try {
      return await this.client.sRem(key, members);
    } catch (err) {
      this.logger.error(`Redis SREM error [${key}]:`, err);
      return null;
    }
  }

  /** Get set cardinality (count) */
  async scard(key: string): Promise<number> {
    try {
      return await this.client.sCard(key);
    } catch {
      return 0;
    }
  }

  /** Get all members of set */
  async smembers(key: string): Promise<string[]> {
    try {
      return await this.client.sMembers(key);
    } catch {
      return [];
    }
  }

  /** Check if member exists in set */
  async sismember(key: string, member: string): Promise<boolean> {
    try {
      const result = await this.client.sIsMember(key, member);
      return Boolean(result);
    } catch {
      return false;
    }
  }

  // ─── List / Queue Operations ──────────────────────────────

  /**
   * Push to left (head) of list
   */
  async lpush(key: string, ...values: any[]): Promise<number | null> {
    try {
      const serialized = values.map((v) =>
        typeof v === "string" ? v : JSON.stringify(v),
      );
      return await this.client.lPush(key, serialized);
    } catch (err) {
      this.logger.error(`Redis LPUSH error [${key}]:`, err);
      return null;
    }
  }

  /**
   * Push to right (tail) of list
   */
  async rpush(key: string, ...values: any[]): Promise<number | null> {
    try {
      const serialized = values.map((v) =>
        typeof v === "string" ? v : JSON.stringify(v),
      );
      return await this.client.rPush(key, serialized);
    } catch (err) {
      this.logger.error(`Redis RPUSH error [${key}]:`, err);
      return null;
    }
  }

  /**
   * Pop from right (tail) of list — FIFO dequeue
   */
  async rpop<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.client.rPop(key);
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch {
      return null;
    }
  }

  /**
   * Pop from left (head) of list — LIFO pop
   */
  async lpop<T = any>(key: string): Promise<T | null> {
    try {
      const value = await this.client.lPop(key);
      if (value === null) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch {
      return null;
    }
  }

  /**
   * Get list length
   */
  async llen(key: string): Promise<number> {
    try {
      return await this.client.lLen(key);
    } catch {
      return 0;
    }
  }

  /**
   * Get list range (0 = first, -1 = last)
   */
  async lrange<T = any>(key: string, start = 0, stop = -1): Promise<T[]> {
    try {
      const values = await this.client.lRange(key, start, stop);
      return values.map((v) => {
        try {
          return JSON.parse(v) as T;
        } catch {
          return v as unknown as T;
        }
      });
    } catch {
      return [];
    }
  }

  /**
   * Trim list to max size (keep newest items)
   */
  async ltrim(key: string, start: number, stop: number): Promise<boolean> {
    try {
      await this.client.lTrim(key, start, stop);
      return true;
    } catch {
      return false;
    }
  }

  // ─── Notification Queue (High-Level) ─────────────────────

  private readonly NOTIFICATION_QUEUE_KEY = "notification_queue";
  private readonly NOTIFICATION_DEDUP_QUEUE_PREFIX = "notif:queue:";
  private readonly NOTIFICATION_STATUS_KEY = "notification_status";
  private readonly MAX_QUEUE_SIZE = 1000;

  /**
   * Enqueue a notification message (buffer when WebSocket is not ready)
   */
  async enqueueNotification(
    message: Omit<QueueMessage, "id" | "createdAt" | "status">,
  ): Promise<string | null> {
    try {
      const id = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
      const fullMessage: QueueMessage = {
        ...message,
        id,
        createdAt: Date.now(),
        status: "pending",
      };

      // Push to queue head
      await this.client.lPush(
        this.NOTIFICATION_QUEUE_KEY,
        JSON.stringify(fullMessage),
      );

      // Track status
      await this.client.hSet(
        this.NOTIFICATION_STATUS_KEY,
        id,
        JSON.stringify({ status: "pending", createdAt: fullMessage.createdAt }),
      );

      // Trim queue if exceeds max size (remove oldest from tail)
      const len = await this.client.lLen(this.NOTIFICATION_QUEUE_KEY);
      if (len > this.MAX_QUEUE_SIZE) {
        const removed = await this.client.rPop(this.NOTIFICATION_QUEUE_KEY);
        if (removed) {
          const removedMsg = JSON.parse(removed);
          await this.client.hDel(this.NOTIFICATION_STATUS_KEY, removedMsg.id);
        }
      }

      this.logger.debug(
        `Enqueued notification ${id}, queue size: ${Math.min(len + 1, this.MAX_QUEUE_SIZE)}`,
      );
      return id;
    } catch (err) {
      this.logger.error("Enqueue notification error:", err);
      return null;
    }
  }

  /**
   * Dequeue a single notification (FIFO — oldest first)
   */
  async dequeueNotification(): Promise<QueueMessage | null> {
    try {
      const data = await this.client.rPop(this.NOTIFICATION_QUEUE_KEY);
      if (!data) return null;

      const message: QueueMessage = JSON.parse(data);
      message.status = "delivered";

      // Update status
      await this.client.hSet(
        this.NOTIFICATION_STATUS_KEY,
        message.id,
        JSON.stringify({ status: "delivered", deliveredAt: Date.now() }),
      );

      return message;
    } catch (err) {
      this.logger.error("Dequeue notification error:", err);
      return null;
    }
  }

  /**
   * Drain all pending notifications (call when WebSocket becomes ready)
   */
  async drainAllNotifications(): Promise<QueueMessage[]> {
    const messages: QueueMessage[] = [];

    try {
      let data: string | null;
      while (
        (data = await this.client.rPop(this.NOTIFICATION_QUEUE_KEY)) !== null
      ) {
        const message: QueueMessage = JSON.parse(data);
        message.status = "delivered";
        messages.push(message);

        await this.client.hSet(
          this.NOTIFICATION_STATUS_KEY,
          message.id,
          JSON.stringify({ status: "delivered", deliveredAt: Date.now() }),
        );
      }

      if (messages.length > 0) {
        this.logger.log(`Drained ${messages.length} notifications from queue`);
      }
    } catch (err) {
      this.logger.error("Drain notifications error:", err);
    }

    return messages;
  }

  /**
   * Check if there are pending notifications
   */
  async hasPendingNotifications(): Promise<boolean> {
    const len = await this.client.lLen(this.NOTIFICATION_QUEUE_KEY);
    return len > 0;
  }

  /**
   * Get pending notification count
   */
  async getPendingNotificationCount(): Promise<number> {
    const listCount = await this.client.lLen(this.NOTIFICATION_QUEUE_KEY);
    const dedupKeys = await this.keys(
      `${this.NOTIFICATION_DEDUP_QUEUE_PREFIX}*`,
    );
    return listCount + dedupKeys.length;
  }

  /**
   * Get notification status
   */
  async getNotificationStatus(id: string): Promise<any | null> {
    const data = await this.client.hGet(this.NOTIFICATION_STATUS_KEY, id);
    if (!data) return null;
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }

  /**
   * Cleanup old notification status entries
   */
  async cleanupNotificationStatus(maxAgeMs = 3600000): Promise<number> {
    try {
      const allStatus = await this.client.hGetAll(this.NOTIFICATION_STATUS_KEY);
      const now = Date.now();
      let cleaned = 0;

      for (const [id, data] of Object.entries(allStatus)) {
        try {
          const status = JSON.parse(data);
          if (now - status.createdAt > maxAgeMs) {
            await this.client.hDel(this.NOTIFICATION_STATUS_KEY, id);
            cleaned++;
          }
        } catch {
          // Invalid entry, remove it
          await this.client.hDel(this.NOTIFICATION_STATUS_KEY, id);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.debug(
          `Cleaned up ${cleaned} old notification status entries`,
        );
      }
      return cleaned;
    } catch {
      return 0;
    }
  }

  // ─── Short URL Cache (High-Level) ────────────────────────

  private readonly SHORT_URL_PREFIX = "shorturl:";
  private readonly SHORT_URL_TTL = 3600; // 1 hour default

  async cacheShortUrl(
    shortUrl: string,
    data: any,
    ttl?: number,
  ): Promise<boolean> {
    return this.set(`${this.SHORT_URL_PREFIX}${shortUrl}`, data, {
      ttl: ttl ?? this.SHORT_URL_TTL,
    });
  }

  async getCachedShortUrl<T = any>(shortUrl: string): Promise<T | null> {
    return this.get<T>(`${this.SHORT_URL_PREFIX}${shortUrl}`);
  }

  async invalidateShortUrl(shortUrl: string): Promise<boolean> {
    return this.del(`${this.SHORT_URL_PREFIX}${shortUrl}`);
  }

  // ─── Config Cache (High-Level) ───────────────────────────

  private readonly CONFIG_PREFIX = "config:";
  private readonly CONFIG_TTL = 600; // 10 minutes

  async cacheConfig(key: string, value: any): Promise<boolean> {
    return this.set(`${this.CONFIG_PREFIX}${key}`, value, {
      ttl: this.CONFIG_TTL,
    });
  }

  async getCachedConfig<T = any>(key: string): Promise<T | null> {
    return this.get<T>(`${this.CONFIG_PREFIX}${key}`);
  }

  async invalidateConfig(key: string): Promise<boolean> {
    return this.del(`${this.CONFIG_PREFIX}${key}`);
  }

  async invalidateAllConfig(): Promise<boolean> {
    const keys = await this.keys(`${this.CONFIG_PREFIX}*`);
    if (keys.length === 0) return true;
    return this.delMany(...keys);
  }

  // ─── User Permission Cache (High-Level) ──────────────────

  private readonly USER_PERM_PREFIX = "user:perm:";
  private readonly USER_PERM_TTL = 300; // 5 minutes

  async cacheUserPermissions(
    userId: string,
    permissions: any,
  ): Promise<boolean> {
    return this.set(`${this.USER_PERM_PREFIX}${userId}`, permissions, {
      ttl: this.USER_PERM_TTL,
    });
  }

  async getCachedUserPermissions<T = any>(userId: string): Promise<T | null> {
    return this.get<T>(`${this.USER_PERM_PREFIX}${userId}`);
  }

  async invalidateUserPermissions(userId: string): Promise<boolean> {
    return this.del(`${this.USER_PERM_PREFIX}${userId}`);
  }

  async invalidateAllUserPermissions(): Promise<void> {
    const keys = await this.keys(`${this.USER_PERM_PREFIX}*`);
    if (keys.length > 0) {
      await this.delMany(...keys);
    }
  }

  // ─── Daily Counter (High-Level) ──────────────────────────

  private readonly DAILY_COUNT_PREFIX = "daily_count:";

  async incrementDailyCount(
    userId: string,
    date?: string,
  ): Promise<number | null> {
    const dateStr = date ?? new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const key = `${this.DAILY_COUNT_PREFIX}${userId}:${dateStr}`;
    // TTL = seconds until midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ttlSeconds = Math.floor((midnight.getTime() - now.getTime()) / 1000);
    return this.incr(key, ttlSeconds);
  }

  async getDailyCount(userId: string, date?: string): Promise<number> {
    const dateStr = date ?? new Date().toISOString().split("T")[0];
    const key = `${this.DAILY_COUNT_PREFIX}${userId}:${dateStr}`;
    const count = await this.get<number>(key);
    return count ?? 0;
  }

  // ─── Generic Cache Helper ────────────────────────────────

  /**
   * Get from cache, or compute and store if missing
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheOptions,
  ): Promise<T | null> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const value = await factory();
    if (value !== null && value !== undefined) {
      await this.set(key, value, options);
    }
    return value;
  }

  // ─── Cache Statistics ────────────────────────────────────

  /**
   * Get cache statistics: key counts per category and estimated memory
   */
  async getCacheStats(): Promise<{
    shortUrl: { count: number; keys: string[] };
    userPermissions: { count: number; keys: string[] };
    dailyCount: { count: number; keys: string[] };
    config: { count: number; keys: string[] };
    totalKeys: number;
    estimatedMemoryBytes: number;
  }> {
    const shortUrlKeys = await this.keys(`${this.SHORT_URL_PREFIX}*`);
    const userPermKeys = await this.keys(`${this.USER_PERM_PREFIX}*`);
    const dailyCountKeys = await this.keys(`${this.DAILY_COUNT_PREFIX}*`);
    const configKeys = await this.keys(`${this.CONFIG_PREFIX}*`);

    const allKeys = [
      ...shortUrlKeys,
      ...userPermKeys,
      ...dailyCountKeys,
      ...configKeys,
    ];

    // Estimate memory by sampling key sizes (serialized JSON length)
    let estimatedMemoryBytes = 0;
    const sampleSize = Math.min(allKeys.length, 50);
    if (sampleSize > 0) {
      const step = Math.max(1, Math.floor(allKeys.length / sampleSize));
      let sampledCount = 0;
      for (let i = 0; i < allKeys.length; i += step) {
        try {
          const val = await this.client.get(allKeys[i]);
          if (val) {
            estimatedMemoryBytes += Buffer.byteLength(val, "utf8");
          }
          // Also count the key itself
          estimatedMemoryBytes += Buffer.byteLength(allKeys[i], "utf8");
          sampledCount++;
        } catch {
          // ignore
        }
      }
      // Extrapolate to full set
      if (sampledCount > 0) {
        estimatedMemoryBytes = Math.round(
          (estimatedMemoryBytes / sampledCount) * allKeys.length,
        );
      }
    }

    return {
      shortUrl: { count: shortUrlKeys.length, keys: shortUrlKeys },
      userPermissions: { count: userPermKeys.length, keys: userPermKeys },
      dailyCount: { count: dailyCountKeys.length, keys: dailyCountKeys },
      config: { count: configKeys.length, keys: configKeys },
      totalKeys: allKeys.length,
      estimatedMemoryBytes,
    };
  }

  // ─── Admin: Flush Cache ─────────────────────────────────────────────

  async flushCache(): Promise<boolean> {
    try {
      await this.client.flushDb();
      await this.client.del(this.NOTIFICATION_QUEUE_KEY);
      await this.client.del(this.NOTIFICATION_DEDUP_QUEUE_PREFIX + "*");
      await this.cleanupNotificationStatus(0);
      this.logger.log("Redis cache and notification queue flushed");
      return true;
    } catch (err: any) {
      this.logger.error("Flush cache error:", err);
      return false;
    }
  }

  // ─── Admin: Get pending notification queue stats ─────────────────────

  async getPendingNotificationQueueStats(): Promise<{
    listCount: number;
    dedupKeyCount: number;
    total: number;
  }> {
    const listCount = await this.client.lLen(this.NOTIFICATION_QUEUE_KEY);
    const dedupKeys = await this.keys(
      `${this.NOTIFICATION_DEDUP_QUEUE_PREFIX}*`,
    );
    return {
      listCount,
      dedupKeyCount: dedupKeys.length,
      total: listCount + dedupKeys.length,
    };
  }
}
