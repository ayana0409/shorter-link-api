export const NOTIFICATION_PROVIDER = 'NOTIFICATION_PROVIDER';

export interface INotificationProvider {
  /**
   * Send a realtime ping/notification to a specific user.
   * Returns true if delivery was successful / user online.
   */
  sendToUser(
    userId: string,
    event: string,
    payload: Record<string, any>,
    username?: string,
  ): Promise<boolean>;

  /**
   * Broadcast a notification to all users of the project.
   */
  broadcast(event: string, payload: Record<string, any>): Promise<void>;
}

