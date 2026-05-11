import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose/dist";
import { Types } from "mongoose";

@Schema({ timestamps: true })
export class Shortener {
  @Prop({ required: true })
  originalUrl!: string;

  @Prop({ required: true, unique: true })
  shortUrl!: string;

  @Prop({ required: false })
  siteName?: string;

  @Prop({ required: false, select: false })
  password?: string;

  @Prop({ type: Number, default: 0 })
  clicks!: number;

  @Prop({ required: false })
  expiresAt?: Date;

  @Prop({ required: false })
  validityFromDate?: Date;

  @Prop({ type: Boolean, default: false })
  noExpiration!: boolean;

  @Prop({ enum: ["active", "expired", "disabled"], default: "active" })
  status!: string;

  @Prop({ required: false })
  userId?: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: "Group" }], default: [] })
  groupIds!: Types.ObjectId[];
}

export const ShortenerSchema = SchemaFactory.createForClass(Shortener);
