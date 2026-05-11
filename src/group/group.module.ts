import { Module, forwardRef } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { GroupController } from "./group.controller";
import { GroupService } from "./group.service";
import { Group, GroupSchema } from "./schemas/group.schema";
import { ShortenerModule } from "../shortener/shortener.module";
import { AuthModule } from "../auth/auth.module";
import { AccountModule } from "../account/account.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Group.name, schema: GroupSchema }]),
    ShortenerModule,
    forwardRef(() => AuthModule),
    AccountModule,
  ],
  controllers: [GroupController],
  providers: [GroupService],
})
export class GroupModule {}
