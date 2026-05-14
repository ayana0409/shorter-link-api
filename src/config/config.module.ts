import { Global, Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConfigController } from "./config.controller";
import { ConfigManagerService } from "./config-manager.service";
import { Config, ConfigSchema } from "./schemas/config.schema";
import { AuthModule } from "../auth/auth.module";
import { AccountModule } from "../account/account.module";

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: Config.name, schema: ConfigSchema }]),
    AuthModule,
    AccountModule,
  ],
  controllers: [ConfigController],
  providers: [ConfigManagerService],
  exports: [ConfigManagerService],
})
export class ConfigModule {}
