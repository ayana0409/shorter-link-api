import { Global, Module, Logger } from "@nestjs/common";
import { createClient, RedisClientType } from "redis";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "./redis.service";
import { ConfigModule } from "../config/config.module";
import { ConfigManagerService } from "../config/config-manager.service";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: RedisService,
      useFactory: async (
        configService: ConfigService,
        configManager: ConfigManagerService,
      ) => {
        // ── Read config from DB first, fallback to .env ──
        const host =
          (await configManager.getByKey("REDIS_HOST")) ||
          configService.get<string>("REDIS_HOST") ||
          "localhost";
        const port =
          Number(await configManager.getByKey("REDIS_PORT")) ||
          configService.get<number>("REDIS_PORT") ||
          6379;
        const username =
          (await configManager.getByKey("REDIS_USERNAME")) ||
          configService.get<string>("REDIS_USERNAME") ||
          "default";
        const password =
          (await configManager.getByKey("REDIS_PASSWORD")) ||
          configService.get<string>("REDIS_PASSWORD") ||
          "";

        const source = (await configManager.getByKey("REDIS_HOST"))
          ? "database"
          : ".env";
        Logger.log(
          `Redis config loaded from ${source}: ${host}:${port}`,
          "RedisModule",
        );

        const client = createClient({
          username,
          password,
          socket: { host, port },
        });

        client.on("error", (err) =>
          Logger.error("Redis Client Error", err, "RedisModule"),
        );
        client.on("connect", () =>
          Logger.log("Redis connected", "RedisModule"),
        );
        client.on("reconnecting", () =>
          Logger.warn("Redis reconnecting...", "RedisModule"),
        );
        client.on("end", () =>
          Logger.warn("Redis connection closed", "RedisModule"),
        );

        await client.connect();

        return new RedisService(client as RedisClientType);
      },
      inject: [ConfigService, ConfigManagerService],
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
