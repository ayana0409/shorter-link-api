import { Global, Module, Logger } from "@nestjs/common";
import { createClient, RedisClientType } from "redis";
import { ConfigService } from "@nestjs/config";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [
    {
      provide: RedisService,
      useFactory: async (configService: ConfigService) => {
        // Read Redis connection from .env (ConfigModule not imported to avoid circular dependency)
        const host = configService.get<string>("REDIS_HOST") || "localhost";
        const port = configService.get<number>("REDIS_PORT") || 6379;
        const username =
          configService.get<string>("REDIS_USERNAME") || "default";
        const password = configService.get<string>("REDIS_PASSWORD") || "";

        Logger.log(
          `Redis config loaded from .env: ${host}:${port}`,
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
      inject: [ConfigService],
    },
  ],
  exports: [RedisService],
})
export class RedisModule {}
