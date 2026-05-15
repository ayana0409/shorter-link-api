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
    // Start background drain loop — process queued notifications every 5s
    this.drainInterval = setInterval(() => this.drainQueue(), 5000);
    this.logger.log(`NotificationService initialized (WS: ${this.wsBaseUrl})`);
  }

  /**
   * Send a notification: persist to DB, push to Redis queue, attempt WebSocket delivery
   */
  async send(
    userId: string,
    event: string,
    payload: Record<string, any>,
  ): Promise<Notification> {
    // 1. Persist to MongoDB
    const notification = await this.notificationModel.create({
      userId: new Types.ObjectId(userId),
      event,
      payload,
      status: NotificationStatus.PENDING,
    });

    // 2. Push to Redis queue for guaranteed delivery
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

    // 3. Attempt immediate WebSocket delivery
    const delivered = await this.tryDeliverViaWebSocket(userId, event, payload);
    if (delivered) {
      await this.markDelivered(notification._id);
    }

    return notification;
  }

  /**
   * Send notification to multiple users
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
   * Broadcast to all connected users via WebSocket
   */
  async broadcast(event: string, payload: Record<string, any>): Promise<void> {
    try {
      await axios.post(`${this.wsBaseUrl}/notify/broadcast`, {
        event,
        payload,
      });
    } catch (err: any) {
      this.logger.warn(`Broadcast failed: ${err.message}`);
    }
  }

  /**
   * Get pending notifications for a user
   */
  async getPendingForUser(userId: string): Promise<Notification[]> {
    return this.notificationModel
      .find({
        userId: new Types.ObjectId(userId),
        status: NotificationStatus.PENDING,
      })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }

  /**
   * Get notification history for a user (paginated)
   */
  async getHistory(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{ notifications: Notification[]; total: number }> {
    const skip = (page - 1) * limit;
    const [notifications, total] = await Promise.all([
      this.notificationModel
        .find({ userId: new Types.ObjectId(userId) })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.notificationModel
        .countDocuments({ userId: new Types.ObjectId(userId) })
        .exec(),
    ]);
    return { notifications, total };
  }

  /**
   * Mark notification as delivered
   */
  async markDelivered(notificationId: Types.ObjectId): Promise<void> {
    await this.notificationModel.findByIdAndUpdate(notificationId, {
      status: NotificationStatus.DELIVERED,
      deliveredAt: new Date(),
    });
  }

  /**
   * Mark notification as failed
   */
  async markFailed(
    notificationId: Types.ObjectId,
    error: string,
  ): Promise<void> {
    await this.notificationModel.findByIdAndUpdate(notificationId, {
      status: NotificationStatus.FAILED,
      errorMessage: error,
      $inc: { retryCount: 1 },
    });
  }

  /**
   * Drain Redis queue — process pending notifications
   */
  private async drainQueue(): Promise<void> {
    try {
      let message = await this.redisService.dequeueNotification();
      while (message) {
        if (message.type === "notification" && message.payload) {
          const { notificationId, userId, event, payload } = message.payload;
          const delivered = await this.tryDeliverViaWebSocket(
            userId,
            event,
            payload,
          );
          if (delivered) {
            await this.markDelivered(new Types.ObjectId(notificationId));
          } else {
            // Re-queue if not delivered (will be retried on next drain cycle)
            const doc = await this.notificationModel.findById(notificationId);
            if (doc && doc.status === NotificationStatus.PENDING) {
              await this.redisService.enqueueNotification(message);
            }
          }
        }
        message = await this.redisService.dequeueNotification();
      }
    } catch (err: any) {
      this.logger.error(`Drain queue error: ${err.message}`);
    }
  }

  /**
   * Try to deliver via WebSocket REST API
   */
  private async tryDeliverViaWebSocket(
    userId: string,
    event: string,
    payload: any,
  ): Promise<boolean> {
    try {
      const response = await axios.post(`${this.wsBaseUrl}/notify/user`, {
        userId,
        event,
        payload,
      });
      return response.data?.delivered ?? false;
    } catch (err: any) {
      this.logger.debug(
        `WebSocket delivery failed for user ${userId}: ${err.message}`,
      );
      return false;
    }
  }
}
