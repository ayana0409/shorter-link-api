import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  Notification,
  NotificationStatus,
} from "./schemas/notification.schema";
import { Account, AccountDocument } from "../account/schemas/account.schema";
import { RedisService } from "../redis/redis.service";
import { ConfigManagerService } from "../config/config-manager.service";
import {
  INotificationProvider,
  NOTIFICATION_PROVIDER,
} from "./providers/notification.provider.interface";

@Injectable()
export class NotificationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationService.name);
  private drainInterval: NodeJS.Timeout | null = null;

  /** Redis set key — stores userIds that have pending notifications queued */
  private readonly QUEUE_SET_KEY = "notif:queued_users";

  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<Notification>,
    @InjectModel(Account.name)
    private readonly accountModel: Model<AccountDocument>,
    private readonly redisService: RedisService,
    private readonly configManager: ConfigManagerService,
    @Inject(NOTIFICATION_PROVIDER)
    private readonly notificationProvider: INotificationProvider,
  ) {}

  async onModuleInit() {
    // Drain queue every 10s — retry pinging users who were offline
    this.drainInterval = setInterval(() => this.drainQueue(), 10000);
    this.logger.log("NotificationService initialized with notification provider");
  }

  onModuleDestroy() {
    if (this.drainInterval) {
      clearInterval(this.drainInterval);
      this.drainInterval = null;
    }
  }

  /**
   * Helper: Resolve target user identifier into both MongoDB ObjectId string and username.
   * Ensures notifications can always be mapped and found regardless of whether ObjectId or username is used.
   */
  private async resolveUserIdentifiers(
    target: string,
    fallbackUsername?: string,
  ): Promise<{ userId: string; username: string }> {
    if (!target) {
      return { userId: target, username: fallbackUsername || target };
    }

    try {
      if (Types.ObjectId.isValid(target)) {
        const acc = await this.accountModel.findById(target).lean().exec();
        if (acc) {
          return { userId: acc._id.toString(), username: acc.username };
        }
      }

      // If not an ObjectId or not found by id, look up by username
      const acc = await this.accountModel
        .findOne({ username: target })
        .lean()
        .exec();
      if (acc) {
        return { userId: acc._id.toString(), username: acc.username };
      }
    } catch (err: any) {
      this.logger.debug(
        `Could not resolve account for ${target}: ${err.message}`,
      );
    }

    return { userId: target, username: fallbackUsername || target };
  }

  /**
   * Send a notification:
   * 1. Resolve and persist to DB with both userId and username (status: pending)
   * 2. Try ping via configured provider (WS or QuickNotify)
   * 3. If ping fails (provider offline / user offline) → add userId to Redis queue
   * 4. Drain queue periodically retries; on success removes userId from queue
   */
  async send(
    userId: string,
    event: string,
    payload: Record<string, any>,
    username?: string,
  ): Promise<Notification> {
    const resolved = await this.resolveUserIdentifiers(userId, username);

    // 1. Persist to DB
    const notification = await this.notificationModel.create({
      userId: resolved.userId,
      username: resolved.username,
      event,
      payload,
      status: NotificationStatus.PENDING,
    });

    // 2. Try ping user via notification provider (passes both userId and username)
    const online = await this.tryPingUser(
      resolved.userId,
      resolved.username,
      event,
      payload,
    );
    if (online) {
      this.logger.debug(
        `User ${resolved.userId} (${resolved.username}) pinged successfully — FE will fetch pending from DB`,
      );
    } else {
      // 3. User offline or provider unreachable → add to Redis queue for retry
      await this.addToQueue(resolved.userId);
      if (resolved.username && resolved.username !== resolved.userId) {
        await this.addToQueue(resolved.username);
      }
      this.logger.debug(
        `User ${resolved.userId} offline / provider unreachable, queued notification ${notification._id} (queued for drain)`,
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
      await this.notificationProvider.broadcast(event, payload);
    } catch (err: any) {
      this.logger.warn(`Broadcast failed: ${err.message}`);
    }
  }

  /**
   * Get pending notifications for a user (called by FE on login/reconnect)
   * Searches by both ObjectId and username
   */
  async getPendingForUser(userId: string): Promise<Notification[]> {
    const resolved = await this.resolveUserIdentifiers(userId);
    const candidateIds = Array.from(
      new Set([userId, resolved.userId, resolved.username].filter(Boolean)),
    );

    const query = {
      $or: [
        { userId: { $in: candidateIds } },
        { username: { $in: candidateIds } },
      ],
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
    const resolved = await this.resolveUserIdentifiers(userId);
    const candidateIds = Array.from(
      new Set([userId, resolved.userId, resolved.username].filter(Boolean)),
    );

    const result = await this.notificationModel.updateMany(
      {
        $or: [
          { userId: { $in: candidateIds } },
          { username: { $in: candidateIds } },
        ],
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
    const resolved = await this.resolveUserIdentifiers(userId);
    const candidateIds = Array.from(
      new Set([userId, resolved.userId, resolved.username].filter(Boolean)),
    );

    const skip = (page - 1) * limit;
    const filter = {
      $or: [
        { userId: { $in: candidateIds } },
        { username: { $in: candidateIds } },
      ],
    };
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

  /**
   * Get number of users in the notification queue.
   */
  async getQueueSize(): Promise<number> {
    try {
      return await this.redisService.scard(this.QUEUE_SET_KEY);
    } catch {
      return 0;
    }
  }

  // ─── Private ──────────────────────────────────────────────

  /**
   * Try to ping a user via notification provider.
   * Dispatches to provider with both userId and username.
   */
  private async tryPingUser(
    userId: string,
    username?: string,
    event = "new_notification",
    payload: Record<string, any> = {},
  ): Promise<boolean> {
    return this.notificationProvider.sendToUser(
      userId,
      event,
      payload,
      username,
    );
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
   * - If ping succeeds (user online) → remove from queue, FE will fetch from DB.
   * - If ping fails (user offline) → remove from queue too, skip it.
   */
  private async drainQueue(): Promise<void> {
    try {
      const userIds = await this.redisService.smembers(this.QUEUE_SET_KEY);
      if (!userIds || userIds.length === 0) return;

      this.logger.debug(`Drain: ${userIds.length} user(s) in queue`);

      for (const target of userIds) {
        const resolved = await this.resolveUserIdentifiers(target);
        const candidateIds = Array.from(
          new Set([target, resolved.userId, resolved.username].filter(Boolean)),
        );

        // Check if user still has pending notifications in DB
        const pendingCount = await this.notificationModel.countDocuments({
          $or: [
            { userId: { $in: candidateIds } },
            { username: { $in: candidateIds } },
          ],
          status: NotificationStatus.PENDING,
        });

        if (pendingCount === 0) {
          // No pending — cleanup queue
          await this.redisService.srem(this.QUEUE_SET_KEY, target);
          continue;
        }

        // Try ping
        const delivered = await this.notificationProvider.sendToUser(
          resolved.userId,
          "new_notification",
          {},
          resolved.username,
        );

        await this.redisService.srem(this.QUEUE_SET_KEY, target);
        if (delivered) {
          this.logger.log(
            `Drain: pinged user ${target} (${pendingCount} pending notifs)`,
          );
        } else {
          this.logger.debug(
            `Drain: user ${target} offline, skipped (will fetch on reconnect)`,
          );
        }
      }
    } catch (err: any) {
      this.logger.error(`Drain queue error: ${err.message}`);
    }
  }
}
