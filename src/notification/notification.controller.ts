import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { QuickNotifyTokenService } from "./quicknotify-token.service";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly quickNotifyTokenService: QuickNotifyTokenService,
  ) {}

  /**
   * Get short-lived token for QuickNotify WebSocket connection
   * GET /notifications/qn-token
   */
  @Get("qn-token")
  @HttpCode(HttpStatus.OK)
  async getQuickNotifyToken(@Req() req: any) {
    const userId =
      req.user?._id?.toString() ||
      req.user?.id ||
      req.user?.sub ||
      req.user?.username;
    const token = await this.quickNotifyTokenService.generateToken(userId);
    return { token };
  }

  /**
   * Get pending notifications for current user
   * GET /notifications/pending
   */
  @Get("pending")
  getPending(@Query("userId") userId: string) {
    return this.notificationService.getPendingForUser(userId);
  }

  /**
   * Get notification history for current user (paginated)
   * GET /notifications/history?userId=xxx&page=1&limit=20
   */
  @Get("history")
  getHistory(
    @Query("userId") userId: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
  ) {
    return this.notificationService.getHistory(userId, page ?? 1, limit ?? 20);
  }

  /**
   * Send notification to a specific user
   * POST /notifications/send
   * Body: { userId: string, event: string, payload: any }
   */
  @Post("send")
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  sendToUser(@Body() body: { userId: string; event: string; payload: any }) {
    return this.notificationService.send(body.userId, body.event, body.payload);
  }

  /**
   * Broadcast notification to all connected users
   * POST /notifications/broadcast
   * Body: { event: string, payload: any }
   */
  @Post("broadcast")
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  broadcast(@Body() body: { event: string; payload: any }) {
    return this.notificationService.broadcast(body.event, body.payload);
  }

  /**
   * Mark all pending notifications as read for current user
   * POST /notifications/mark-as-read
   * Body: { userId: string }
   */
  @Post("mark-as-read")
  @HttpCode(HttpStatus.OK)
  markAsRead(@Body() body: { userId: string }) {
    return this.notificationService.markAsRead(body.userId);
  }

  /**
   * Get notification queue health info
   * GET /notifications/queue-health
   */
  @Get("queue-health")
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.OK)
  async getQueueHealth() {
    const queueSize = await this.notificationService.getQueueSize();
    return { queueSize };
  }
}
