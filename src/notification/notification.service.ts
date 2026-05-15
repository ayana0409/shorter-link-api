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
    this.drainInterval = setInterval(() => this.drainQueue(), 10000);
    this.logger.log(`NotificationService initialized (WS: ${this.wsBaseUrl})`);
  }

  /**
   * Send a notification:
   * 1. Persist to DB (status: pending)
   * 2. Try immediate WebSocket delivery
   * 3. If WebSocket fails → push to Redis queue for retry
   */
  async send(
    userId: string,
    event: string,
    payload: Record<string, any>,
    username?: string,
  ): Promise<Notification> {
    const notification = await this.notificationModel.create({
      userId,
      username: username || null,
      event,
      payload,
      status: NotificationStatus.PENDING,
    });

    const delivered = await this.tryDeliver(userId, event, payload);
    if (delivered) {
      await this.markDelivered(notification._id);
      return notification;
    }

    // WebSocket unavailable → queue for retry
    await this.redisService.enqueueNotification({
      type: "notification",
      payload: {
        notificationId: notification._id.toString(),
        userId,
        event,
        payload,
      },
      targetUserId: userId,
    });
    this.logger.debug(
      `Notification ${notification._id} queued for user ${userId}`,
    );

    return notification;
  }

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
   * Get pending notifications — userId can be ObjectId string or username
   */
  async getPendingForUser(userId: string): Promise<Notification[]> {
    // Try matching by userId first, then by username
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

  private async tryDeliver(
    userId: string,
    event: string,
    payload: any,
  ): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.wsBaseUrl}/notify/user`,
        { userId, event, payload },
        { timeout: 3000 },
      );
      return response.data?.delivered ?? false;
    } catch {
      return false;
    }
  }

  private async drainQueue(): Promise<void> {
    try {
      let message = await this.redisService.dequeueNotification();
      let processed = 0;
      const maxPerCycle = 20;

      while (message && processed < maxPerCycle) {
        processed++;

        if (message.type === "notification" && message.payload) {
          const { notificationId, userId, event, payload } = message.payload;

          const doc = await this.notificationModel
            .findById(notificationId)
            .lean()
            .exec();
          if (!doc || doc.status !== NotificationStatus.PENDING) {
            message = await this.redisService.dequeueNotification();
            continue;
          }

          const retryCount = doc.retryCount ?? 0;
          if (retryCount >= 5) {
            await this.notificationModel.findByIdAndUpdate(notificationId, {
              status: NotificationStatus.FAILED,
              errorMessage: "Max retries exceeded",
            });
            this.logger.warn(
              `Notification ${notificationId} failed after 5 retries`,
            );
            message = await this.redisService.dequeueNotification();
            continue;
          }

          const delivered = await this.tryDeliver(userId, event, payload);
          if (delivered) {
            await this.markDelivered(new Types.ObjectId(notificationId));
            this.logger.debug(
              `Queued notification ${notificationId} delivered to user ${userId}`,
            );
          } else {
            await this.notificationModel.findByIdAndUpdate(notificationId, {
              $inc: { retryCount: 1 },
            });
            await this.redisService.enqueueNotification(message);
          }
        }

        message = await this.redisService.dequeueNotification();
      }
    } catch (err: any) {
      this.logger.error(`Drain queue error: ${err.message}`);
    }
  }
}
