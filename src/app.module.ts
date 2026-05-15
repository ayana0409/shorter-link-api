import { Module, Logger } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
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
import { I18nModule } from "./common/i18n";
import { RedisModule } from "./redis";
import { DatabaseModule } from "./database/database.module";
import { NotificationModule } from "./notification";
import * as mongoose from "mongoose";

const MONGO_RETRY_DELAY_MS = 5000;

async function connectMongoWithRetry(uri: string): Promise<void> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await mongoose.connect(uri, {
        retryWrites: true,
        w: "majority",
        maxPoolSize: 10,
        minPoolSize: 2,
        socketTimeoutMS: 30000,
        connectTimeoutMS: 30000,
        serverSelectionTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000,
        family: 4,
        bufferCommands: true,
      });
      Logger.log(`MongoDB connected (attempt ${attempt})`, "MongooseModule");
      return;
    } catch (err: any) {
      Logger.warn(
        `MongoDB connection attempt ${attempt} failed: ${err.message}. Retrying in ${MONGO_RETRY_DELAY_MS / 1000}s...`,
        "MongooseModule",
      );
      await new Promise((resolve) => setTimeout(resolve, MONGO_RETRY_DELAY_MS));
    }
  }
}

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
        // Infinite retry — never crash the app on DB connection errors
        await connectMongoWithRetry(uri);
        return { uri };
      },
    }),
    DatabaseModule,
    ShortenerModule,
    AccountModule,
    AuthModule,
    AuditLogModule,
    GroupModule,
    SystemConfigModule,
    I18nModule,
    RedisModule,
    NotificationModule,
  ],
  controllers: [AppController],
  providers: [AppService, LoggingInterceptor, AllExceptionsFilter],
})
export class AppModule {}
