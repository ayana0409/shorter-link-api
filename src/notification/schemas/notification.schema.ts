import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationStatus {
  PENDING = "pending",
  DELIVERED = "delivered",
  FAILED = "failed",
}

@Schema({ timestamps: true })
export class Notification {
  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({ type: String, default: null })
  username!: string;

  @Prop({ required: true })
  event!: string;

  @Prop({ type: Object, required: true })
  payload!: Record<string, any>;

  @Prop({
    enum: NotificationStatus,
    default: NotificationStatus.PENDING,
    index: true,
  })
  status!: NotificationStatus;

  @Prop({ type: Date, default: null })
  deliveredAt!: Date | null;

  @Prop({ type: Number, default: 0 })
  retryCount!: number;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
