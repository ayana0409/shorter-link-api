import { forwardRef, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Level, LevelSchema } from "./schemas/level.schema";
import { LevelService } from "./level.service";
import { LevelController } from "./level.controller";
import { AuthModule } from "../auth/auth.module";
import { AdminGuard } from "../auth/admin.guard";
import { AuthGuard } from "../auth/auth.guard";
import { AccountModule } from "./account.module";
import { ManagerGuard } from "../auth/manager.guard";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Level.name, schema: LevelSchema }]),
    forwardRef(() => AuthModule),
    forwardRef(() => AccountModule),
  ],
  controllers: [LevelController],
  providers: [LevelService, AuthGuard, AdminGuard, ManagerGuard],
  exports: [LevelService],
})
export class LevelModule {}
