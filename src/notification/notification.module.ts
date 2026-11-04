import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { NotificationService } from "./notification.service";
import { NotificationController } from "./notification.controller";
import {
  Notification,
  NotificationSchema,
} from "./schemas/notification.schema";
import { AuthModule } from "../auth/auth.module";
import { AccountModule } from "../account/account.module";
import { RedisModule } from "../redis/redis.module";
import { WebSocketProvider } from "./providers/websocket.provider";
import { QuickNotifyProvider } from "./providers/quicknotify.provider";
import { NOTIFICATION_PROVIDER } from "./providers/notification.provider.interface";
import { QuickNotifyTokenService } from "./quicknotify-token.service";
import { ConfigManagerService } from "../config/config-manager.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    AuthModule,
    AccountModule,
    RedisModule,
  ],
  controllers: [NotificationController],
  providers: [
    WebSocketProvider,
    QuickNotifyProvider,
    QuickNotifyTokenService,
    {
      provide: NOTIFICATION_PROVIDER,
      useFactory: (
        configManager: ConfigManagerService,
        wsProvider: WebSocketProvider,
        qnProvider: QuickNotifyProvider,
      ) => {
        const providerType = (
          process.env.NOTIFICATION_PROVIDER || "websocket"
        ).toLowerCase();
        return providerType === "quicknotify" ? qnProvider : wsProvider;
      },
      inject: [ConfigManagerService, WebSocketProvider, QuickNotifyProvider],
    },
    NotificationService,
  ],
  exports: [NotificationService, MongooseModule, QuickNotifyTokenService],
})
export class NotificationModule {}
