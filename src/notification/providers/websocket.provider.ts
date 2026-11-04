import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigManagerService } from '../../config/config-manager.service';
import { INotificationProvider } from './notification.provider.interface';
import axios from 'axios';

@Injectable()
export class WebSocketProvider implements INotificationProvider, OnModuleInit {
  private readonly logger = new Logger(WebSocketProvider.name);
  private wsBaseUrl = 'http://localhost:3002';

  constructor(private readonly configManager: ConfigManagerService) {}

  async onModuleInit() {
    try {
      this.wsBaseUrl = await this.configManager.getValue(
        'WS_URL',
        'http://localhost:3002',
      );
    } catch {
      this.wsBaseUrl = 'http://localhost:3002';
    }
  }

  /**
   * Send a ping to a single target via legacy WebSocket gateway.
   */
  private async tryPing(
    target: string,
    event: string,
    payload: Record<string, any>,
  ): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.wsBaseUrl}/notify/user`,
        {
          userId: target,
          event,
          payload,
        },
        { timeout: 3000 },
      );
      return response.data?.delivered ?? false;
    } catch (err: any) {
      this.logger.debug(`Legacy WS ping ${target} failed: ${err.code || err.message}`);
      return false;
    }
  }

  async sendToUser(
    userId: string,
    event: string,
    payload: Record<string, any>,
    username?: string,
  ): Promise<boolean> {
    if (await this.tryPing(userId, event, payload)) {
      return true;
    }

    if (username && username !== userId) {
      if (await this.tryPing(username, event, payload)) {
        return true;
      }
    }

    return false;
  }

  async broadcast(event: string, payload: Record<string, any>): Promise<void> {
    try {
      await axios.post(
        `${this.wsBaseUrl}/notify/broadcast`,
        { event, payload },
        { timeout: 3000 },
      );
    } catch (err: any) {
      this.logger.warn(`Legacy WS broadcast failed: ${err.message}`);
    }
  }
}

