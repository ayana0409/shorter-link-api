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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
    AuthModule,
    AccountModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: [NotificationService, MongooseModule],
})
export class NotificationModule {}
