import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type GroupMemberRole = "owner" | "manager" | "member";
export type GroupMember = {
  account: Types.ObjectId;
  role: GroupMemberRole;
};
export type GroupDocument = Group & Document;

@Schema({ timestamps: true })
export class Group {
  @Prop({ required: true })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: "Account", required: true })
  owner!: Types.ObjectId;

  @Prop({
    type: [
      {
        account: { type: Types.ObjectId, ref: "Account", required: true },
        role: {
          type: String,
          enum: ["owner", "manager", "member"],
          required: true,
          default: "member",
        },
      },
    ],
    default: [],
  })
  members!: GroupMember[];

  @Prop({ type: [{ type: Types.ObjectId, ref: "Shortener" }], default: [] })
  links!: Types.ObjectId[];
}

export const GroupSchema = SchemaFactory.createForClass(Group);
