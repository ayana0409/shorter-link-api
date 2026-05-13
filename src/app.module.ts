import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { MongooseModule } from "@nestjs/mongoose";
import { ShortenerModule } from "./shortener/shortener.module";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AccountModule } from "./account/account.module";
import { AuthModule } from "./auth/auth.module";
import { AuditLogModule } from "./audit-log/audit-log.module";
import { GroupModule } from "./group/group.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { ConfigModule as SystemConfigModule } from "./config/config.module";
import { ConfigManagerService } from "./config/config-manager.service";
import { ThrottlerModule } from "@nestjs/throttler";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    ThrottlerModule.forRootAsync({
      imports: [SystemConfigModule],
      inject: [ConfigManagerService],
      useFactory: async (configManager: ConfigManagerService) => {
        const ttl = await configManager.getNumberValue("RATE_LIMIT_TTL", 60000);
        const limit = await configManager.getNumberValue("RATE_LIMIT_MAX", 100);
        return [{ ttl, limit }];
      },
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const uri = configService.get<string>("MONGO_DB_CONNECTIONSTRING");
        if (!uri) {
          throw new Error("MONGO_DB_CONNECTIONSTRING is not defined!");
        }
        return { uri };
      },
    }),
    ShortenerModule,
    AccountModule,
    AuthModule,
    AuditLogModule,
    GroupModule,
    SystemConfigModule,
  ],
  controllers: [AppController],
  providers: [AppService, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
