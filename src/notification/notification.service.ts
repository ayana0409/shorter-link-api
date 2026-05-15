import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  Notification,
  NotificationStatus,
} from "./schemas/notification.schema";
import { RedisService } from "../redis/redis.service";
import { ConfigManagerService } from "../config/config-manager.service";
import axios from "axios";

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);
  private wsBaseUrl: string = "http://localhost:3002";
  private drainInterval: NodeJS.Timeout | null = null;

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
    // Drain queue every 10s — ping users to fetch notifications
    this.drainInterval = setInterval(() => this.drainQueue(), 10000);
    this.logger.log(`NotificationService initialized (WS: ${this.wsBaseUrl})`);
  }

  /**
   * Send a notification:
   * 1. Persist to DB (status: pending)
   * 2. If user online → ping via WebSocket → user fetches from DB
   * 3. If user offline → push to Redis queue (1 per user) → retry when online
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
    const pinged = await this.pingUser(userId);
    if (pinged) {
      this.logger.debug(
        `Pinged user ${userId} via WebSocket, they will fetch from DB`,
      );
      return notification;
    }

    // 3. User offline → queue for later (only 1 entry per user)
    await this.queuePing(userId);
    this.logger.debug(`User ${userId} offline, queued ping for later`);

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
   * Broadcast ping to all connected users
   */
  async broadcast(event: string, payload: Record<string, any>): Promise<void> {
    try {
      await axios.post(
        `${this.wsBaseUrl}/notify/broadcast`,
        { event: "new_notification", payload },
        { timeout: 3000 },
      );
    } catch (err: any) {
      this.logger.warn(`Broadcast failed: ${err.message}`);
    }
  }

  /**
   * Get pending notifications for a user (called by FE on login/poll/ping)
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
   * Mark all pending as read
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

  async markDelivered(notificationId: Types.ObjectId): Promise<void> {
    await this.notificationModel.findByIdAndUpdate(notificationId, {
      status: NotificationStatus.DELIVERED,
      deliveredAt: new Date(),
    });
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Ping user via WebSocket — just notify "you have new notifications"
   * Returns true if user is online and ping was sent
   */
  private async pingUser(userId: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.wsBaseUrl}/notify/user`,
        {
          userId,
          event: "new_notification",
          payload: {}, // empty payload — user will fetch from DB
        },
        { timeout: 3000 },
      );
      return response.data?.delivered ?? false;
    } catch {
      return false;
    }
  }

  /**
   * Queue a ping for user (only 1 per user in queue)
   * Uses Redis SET to deduplicate
   */
  private async queuePing(userId: string): Promise<void> {
    // Use a Redis SET key per user to avoid duplicates
    await this.redisService.set(`notif:queue:${userId}`, "1", { ttl: 3600 }); // 1h TTL
  }

  /**
   * Drain queue — ping users who have pending notifications
   * Only 1 ping per user, user fetches all pending from DB
   */
  private async drainQueue(): Promise<void> {
    try {
      // Get all queued user IDs from Redis
      const keys = await this.redisService.keys("notif:queue:*");
      if (!keys || keys.length === 0) return;

      for (const key of keys) {
        const userId = key.replace("notif:queue:", "");

        // Check if user has pending notifications
        const pendingCount = await this.notificationModel
          .countDocuments({
            $or: [{ userId }, { username: userId }],
            status: NotificationStatus.PENDING,
          })
          .exec();

        if (pendingCount === 0) {
          // No pending notifications — remove from queue
          await this.redisService.del(key);
          continue;
        }

        // Try ping user
        const pinged = await this.pingUser(userId);
        if (pinged) {
          // User online — remove from queue, they will fetch from DB
          await this.redisService.del(key);
          this.logger.debug(
            `Drain: pinged user ${userId}, they have ${pendingCount} pending notifications`,
          );
        }
        // If user still offline — keep in queue for next drain cycle
      }
    } catch (err: any) {
      this.logger.error(`Drain queue error: ${err.message}`);
    }
  }
}
