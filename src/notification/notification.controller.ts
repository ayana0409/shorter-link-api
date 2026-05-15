import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { NotificationService } from "./notification.service";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";

@Controller("notifications")
@UseGuards(AuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

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
}
