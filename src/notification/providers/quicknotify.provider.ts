import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigManagerService } from '../../config/config-manager.service';
import { INotificationProvider } from './notification.provider.interface';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * Standard QuickNotify envelope structure according to documentation
 */
interface QuickNotifyEnvelope {
  event_id: string;
  project_id: string;
  scope: 'user' | 'project_global' | 'system_global';
  priority: 'normal' | 'high';
  channels: string[];
  target: {
    user_id?: string;
    email?: string;
  };
  content: {
    type: 'raw' | 'template';
    data: Record<string, any>;
  };
}

@Injectable()
export class QuickNotifyProvider implements INotificationProvider, OnModuleInit {
  private readonly logger = new Logger(QuickNotifyProvider.name);
  private quickNotifyUrl = 'http://localhost:8080';
  private readonly PROJECT_ID = 'shorterlink';

  constructor(private readonly configManager: ConfigManagerService) {}

  async onModuleInit() {
    try {
      this.quickNotifyUrl =
        process.env.QUICKNOTIFY_URL ||
        (await this.configManager.getValue(
          'QUICKNOTIFY_URL',
          'http://localhost:8080',
        ));
    } catch {
      this.quickNotifyUrl =
        process.env.QUICKNOTIFY_URL || 'http://localhost:8080';
    }
    this.logger.log(`QuickNotifyProvider initialized with URL: ${this.quickNotifyUrl}`);
  }

  /**
   * Internal helper: Dispatches a notification envelope to a specific target user ID in QuickNotify
   */
  private async dispatchToTarget(
    targetId: string,
    event: string,
    payload: Record<string, any>,
  ): Promise<boolean> {
    const eventId = `evt_sl_${uuidv4 ? uuidv4() : Date.now()}`;
    const envelope: QuickNotifyEnvelope = {
      event_id: eventId,
      project_id: this.PROJECT_ID,
      scope: 'user',
      priority: 'normal',
      channels: ['websocket'],
      target: {
        user_id: targetId,
      },
      content: {
        type: 'raw',
        data: {
          message: payload.message || '',
          event,
          ...payload,
        },
      },
    };

    try {
      const response = await axios.post(
        `${this.quickNotifyUrl}/api/v1/notify`,
        envelope,
        {
          timeout: 3000,
          headers: { 'Content-Type': 'application/json' },
        },
      );
      return response.status >= 200 && response.status < 300;
    } catch (err: any) {
      this.logger.warn(
        `QuickNotify dispatch failed for ${targetId}: ${err.message}`,
      );
      return false;
    }
  }

  /**
   * Send notification to user:
   * Dispatches to both userId (ObjectId) and username (if available)
   * to guarantee delivery regardless of client token format.
   */
  async sendToUser(
    userId: string,
    event: string,
    payload: Record<string, any>,
    username?: string,
  ): Promise<boolean> {
    const p1 = this.dispatchToTarget(userId, event, payload);
    let p2: Promise<boolean> = Promise.resolve(false);

    if (username && username !== userId) {
      p2 = this.dispatchToTarget(username, event, payload);
    }

    const [res1, res2] = await Promise.all([p1, p2]);
    return res1 || res2;
  }

  async broadcast(event: string, payload: Record<string, any>): Promise<void> {
    const eventId = `evt_sl_broadcast_${uuidv4 ? uuidv4() : Date.now()}`;
    const envelope: QuickNotifyEnvelope = {
      event_id: eventId,
      project_id: this.PROJECT_ID,
      scope: 'project_global',
      priority: 'normal',
      channels: ['websocket'],
      target: {},
      content: {
        type: 'raw',
        data: {
          message: payload.message || '',
          event: event || 'system_global',
          ...payload,
        },
      },
    };

    try {
      this.logger.log(
        `Broadcasting project_global notification ${eventId} to QuickNotify`,
      );
      await axios.post(
        `${this.quickNotifyUrl}/api/v1/notify`,
        envelope,
        {
          timeout: 3000,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } catch (err: any) {
      this.logger.warn(`QuickNotify broadcast failed: ${err.message}`);
    }
  }
}
