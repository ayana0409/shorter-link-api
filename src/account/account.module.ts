import { forwardRef, Module } from "@nestjs/common";
import { AccountService } from "./account.service";
import { AccountController } from "./account.controller";
import { Account, AccountSchema } from "./schemas/account.schema";
import { Level, LevelSchema } from "./schemas/level.schema";
import { MongooseModule } from "@nestjs/mongoose/dist/mongoose.module";
import { AuthModule } from "../auth/auth.module";
import { ShortenerModule } from "../shortener/shortener.module";
import { LevelModule } from "./level.module";
import { GroupModule } from "../group/group.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Account.name, schema: AccountSchema },
      { name: Level.name, schema: LevelSchema },
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => ShortenerModule),
    forwardRef(() => LevelModule),
    forwardRef(() => GroupModule),
  ],
  controllers: [AccountController],
  providers: [AccountService],
  exports: [AccountService, MongooseModule],
})
export class AccountModule {}
