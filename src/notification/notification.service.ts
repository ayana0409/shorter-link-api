import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Notification,
  NotificationStatus,
} from "./schemas/notification.schema";
import { RedisService } from "../redis/redis.service";
import { ConfigManagerService } from "../config/config-manager.service";
import axios from "axios";

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private wsBaseUrl: string = "http://localhost:3002";
  private drainInterval: NodeJS.Timeout | null = null;

  /** Redis set key — stores userIds that have pending notifications queued */
  private readonly QUEUE_SET_KEY = "notif:queued_users";

  constructor(
    @InjectModel(Notification.name)
    private notificationModel: Model<Notification>,
    private readonly redisService: RedisService,
    private readonly configManager: ConfigManagerService,
  ) {}

  async onModuleInit() {
    try {
      this.wsBaseUrl = await this.configManager.getValue(
        "WS_URL",
        "http://localhost:3002",
      );
    } catch {
      this.wsBaseUrl = "http://localhost:3002";
    }
    // Drain queue every 10s — retry pinging users who were offline
    this.drainInterval = setInterval(() => this.drainQueue(), 10000);
    this.logger.log(`NotificationService initialized (WS: ${this.wsBaseUrl})`);
  }

  onModuleDestroy() {
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
      this.drainInterval = null;
    }
  }

  /**
   * Send a notification:
   * 1. Persist to DB (status: pending)
   * 2. Try ping via WebSocket — if success, FE will fetch from DB
   * 3. If ping fails (WS offline / user offline) → add userId to Redis queue
   * 4. Drain queue periodically retries; on success removes userId from queue
   */
  async send(
    userId: string,
    event: string,
    payload: Record<string, any>,
    username?: string,
  ): Promise<Notification> {
    // 1. Persist to DB
    const notification = await this.notificationModel.create({
      userId,
      username: username || null,
      event,
      payload,
      status: NotificationStatus.PENDING,
    });

    // 2. Try ping user via WebSocket
    const online = await this.tryPingUser(userId, username);
    if (online) {
      this.logger.debug(
        `User ${userId} is online, pinged — FE will fetch pending from DB`,
      );
      // Notification stays pending — FE fetches and marks as read
    } else {
      // 3. User offline or WS unreachable → add to Redis queue for retry
      await this.addToQueue(userId);
      if (username && username !== userId) {
        await this.addToQueue(username);
      }
      this.logger.debug(
        `User ${userId} offline / WS unreachable, queued notification ${notification._id} (queued for drain)`,
      );
    }

    return notification;
  }

  /**
   * Send to multiple users
   */
  async sendToMany(
    userIds: string[],
    event: string,
    payload: Record<string, any>,
  ): Promise<Notification[]> {
    const notifications: Notification[] = [];
    for (const userId of userIds) {
      const n = await this.send(userId, event, payload);
      notifications.push(n);
    }
    return notifications;
  }

  /**
   * Broadcast to all connected users
   */
  async broadcast(event: string, payload: Record<string, any>): Promise<void> {
    try {
      await axios.post(
        `${this.wsBaseUrl}/notify/broadcast`,
        { event, payload },
        { timeout: 3000 },
      );
    } catch (err: any) {
      this.logger.warn(`Broadcast failed: ${err.message}`);
    }
  }

  /**
   * Get pending notifications for a user (called by FE on login/reconnect)
   */
  async getPendingForUser(userId: string): Promise<Notification[]> {
    const query = {
      $or: [{ userId }, { username: userId }],
      status: NotificationStatus.PENDING,
    };
    return this.notificationModel
      .find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  /**
   * Mark all pending as delivered
   */
  async markAsRead(userId: string): Promise<number> {
    const result = await this.notificationModel.updateMany(
      {
        $or: [{ userId }, { username: userId }],
        status: NotificationStatus.PENDING,
      },
      { status: NotificationStatus.DELIVERED, deliveredAt: new Date() },
    );
    return result.modifiedCount;
  }

  /**
   * Get notification history (paginated)
   */
  async getHistory(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ notifications: Notification[]; total: number }> {
    const skip = (page - 1) * limit;
    const filter = { $or: [{ userId }, { username: userId }] };
    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel.countDocuments(filter).exec(),
    ]);
    return { notifications, total };
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Try to ping a user via WebSocket (empty payload — FE fetches from DB).
   * Tries userId first, then username as fallback.
   * Returns true only if WS gateway confirms user is connected.
   */
  private async tryPingUser(
    userId: string,
    username?: string,
  ): Promise<boolean> {
    if (await this.tryPing(userId)) return true;
    if (username && username !== userId) {
      if (await this.tryPing(username)) return true;
    }
    return false;
  }

  /**
   * Send ping to a single target via WS gateway.
   */
  private async tryPing(target: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.wsBaseUrl}/notify/user`,
        {
          userId: target,
          event: "new_notification",
          payload: {},
        },
        { timeout: 3000 },
      );
      return response.data?.delivered ?? false;
    } catch (err: any) {
      this.logger.debug(`Ping ${target} failed: ${err.code || err.message}`);
      return false;
    }
  }

  /**
   * Add userId to Redis queue set for later drain.
   */
  private async addToQueue(userId: string): Promise<void> {
    try {
      const added = await this.redisService.sadd(this.QUEUE_SET_KEY, userId);
      this.logger.debug(`Added ${userId} to queue (sadd result: ${added})`);
    } catch (err: any) {
      this.logger.error(`Failed to add ${userId} to queue: ${err.message}`);
    }
  }

  /**
   * Drain queue: for each queued userId, try to ping.
   * If ping succeeds (user online) → remove from queue so FE can fetch from DB.
   * If ping fails → keep in queue for next cycle.
   * No need to check online/offline — just ping and let WS gateway handle it.
   */
  private async drainQueue(): Promise<void> {
    try {
      const userIds = await this.redisService.smembers(this.QUEUE_SET_KEY);
      if (!userIds || userIds.length === 0) return;

      this.logger.debug(`Drain: ${userIds.length} user(s) in queue`);

      for (const target of userIds) {
        // Check if user still has pending notifications in DB
        const pendingCount = await this.notificationModel.countDocuments({
          $or: [{ userId: target }, { username: target }],
          status: NotificationStatus.PENDING,
        });

        if (pendingCount === 0) {
          // No pending — cleanup queue
          await this.redisService.srem(this.QUEUE_SET_KEY, target);
          continue;
        }

        // Try ping — just send, don't care about result
        // If user is online, WS gateway emits event → FE fetches from DB
        // If user offline, ping fails silently → keep in queue for next cycle
        const delivered = await this.tryPing(target);
        if (delivered) {
          await this.redisService.srem(this.QUEUE_SET_KEY, target);
          this.logger.log(
            `Drain: pinged user ${target} (${pendingCount} pending notifs)`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Drain queue error: ${err.message}`);
    }
  }
}
