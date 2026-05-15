import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose/dist";
import { Model } from "mongoose";
import { Config } from "./schemas/config.schema";
import { ConfigService as NestConfigService } from "@nestjs/config";
import { UpdateConfigDto } from "./dto/update-config.dto";
import { I18nService } from "../common/i18n";
import { RedisService } from "../redis";
import { ModuleRef } from "@nestjs/core";

@Injectable()
export class ConfigManagerService implements OnModuleInit {
  private redisCache: RedisService | null = null;

  constructor(
    @InjectModel(Config.name) private configModel: Model<Config>,
    private configService: NestConfigService,
    private i18n: I18nService,
    private moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    await this.initializeDefaultConfigs();
    await this.warmUpCache();
  }

  private get redis(): RedisService | null {
    if (!this.redisCache) {
      try {
        this.redisCache = this.moduleRef.get(RedisService, { strict: false });
      } catch {
        return null;
      }
    }
    return this.redisCache;
  }

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

  /** Warm up: load all DB config into Redis cache */
  private async warmUpCache(): Promise<void> {
    if (!this.redis) return;
    try {
      const allConfigs = await this.configModel.find().lean().exec();
      for (const cfg of allConfigs) {
        await this.redis.cacheConfig(cfg.key, cfg.value);
      }
    } catch {
      // ignore cache warm-up errors
    }
  }

  private async initializeDefaultConfigs() {
    const defaultConfigs = [
      {
        key: "DAILY_SHORTEN_LIMIT",
        value: this.configService.get<string>("DAILY_SHORTEN_LIMIT", "10"),
        description:
          "Maximum number of links a regular user can create per day",
        type: "number",
      },
      {
        key: "SHORT_URL_LENGTH",
        value: this.configService.get<string>("SHORT_URL_LENGTH", "6"),
        description: "Length of the shortened URL",
        type: "number",
      },
      {
        key: "SHORT_URL_EXPIRATION_DAYS",
        value: this.configService.get<string>(
          "SHORT_URL_EXPIRATION_DAYS",
          "300",
        ),
        description: "Expiration time for shortened links (in minutes)",
        type: "number",
      },
      {
        key: "MONGO_DB_CONNECTIONSTRING",
        value: this.configService.get<string>(
          "MONGO_DB_CONNECTIONSTRING",
          "mongodb://localhost:27017/shorter-link",
        ),
        description: "MongoDB database connection string",
        type: "string",
        isHidden: true,
      },
      {
        key: "MAX_GROUPS_COUNT",
        value: this.configService.get<string>("MAX_GROUPS_COUNT", "5"),
        description: "Maximum number of groups each user can create",
        type: "number",
      },
      {
        key: "MAX_MEMBERS_PER_GROUP",
        value: this.configService.get<string>("MAX_MEMBERS_PER_GROUP", "10"),
        description: "Maximum number of members in a group",
        type: "number",
      },
      {
        key: "MAX_LINKS_PER_GROUP",
        value: this.configService.get<string>("MAX_LINKS_PER_GROUP", "20"),
        description: "Maximum number of links in a group",
        type: "number",
      },
      {
        key: "RATE_LIMIT_TTL",
        value: this.configService.get<string>("RATE_LIMIT_TTL", "60000"),
        description: "Rate limit time window (ms)",
        type: "number",
      },
      {
        key: "RATE_LIMIT_MAX",
        value: this.configService.get<string>("RATE_LIMIT_MAX", "100"),
        description: "Maximum number of requests within the rate limit window",
        type: "number",
      },
      // ─── WebSocket ───────────────────────────────────────────
      {
        key: "WS_URL",
        value:
          this.configService.get<string>("WS_URL") || "http://localhost:3002",
        description: "WebSocket server URL for notifications",
        type: "string",
        isHidden: true,
      },
      // ─── Redis Connection ─────────────────────────────────────
      {
        key: "REDIS_HOST",
        value: this.configService.get<string>("REDIS_HOST") || "localhost",
        description: "Redis server host",
        type: "string",
        isHidden: true,
      },
      {
        key: "REDIS_PORT",
        value: this.configService.get<string>("REDIS_PORT") || "6379",
        description: "Redis server port",
        type: "number",
        isHidden: true,
      },
      {
        key: "REDIS_USERNAME",
        value: this.configService.get<string>("REDIS_USERNAME") || "default",
        description: "Redis username",
        type: "string",
        isHidden: true,
      },
      {
        key: "REDIS_PASSWORD",
        value: this.configService.get<string>("REDIS_PASSWORD") || "",
        description: "Redis password",
        type: "string",
        isHidden: true,
      },
    ];

    for (const config of defaultConfigs) {
      const exists = await this.configModel.findOne({ key: config.key }).exec();
      if (!exists) {
        await this.configModel.create(config);
      }
    }
  }

  async getAll() {
    return this.configModel.find().exec();
  }

  async getByKey(key: string): Promise<string | null> {
    // Try Redis cache first
    if (this.redis) {
      try {
        const cached = await this.redis.getCachedConfig(key);
        if (cached !== null && cached !== undefined) {
          return cached;
        }
      } catch {
        // ignore cache read errors, fall through to DB
      }
    }

    // Try to get from DB
    const config = await this.configModel.findOne({ key }).exec();
    if (config) {
      // Populate cache for next read
      if (this.redis) {
        try {
          await this.redis.cacheConfig(key, config.value);
        } catch {
          // ignore cache write errors
        }
      }
      return config.value;
    }

    // Fallback to .env
    const envValue = this.configService.get<string>(key);
    return envValue ?? null;
  }

  async updateByKey(key: string, updateConfigDto: UpdateConfigDto) {
    const result = await this.configModel
      .findOneAndUpdate({ key }, updateConfigDto, { new: true, upsert: false })
      .exec();

    // Invalidate + re-populate cache
    if (result && this.redis) {
      try {
        await this.redis.invalidateConfig(key);
        await this.redis.cacheConfig(key, result.value);
      } catch {
        // ignore cache errors
      }
    }

    return result;
  }

  async getValue(key: string, defaultValue?: string): Promise<string> {
    const value = await this.getByKey(key);
    return value || defaultValue || "";
  }

  async getNumberValue(key: string, defaultValue?: number): Promise<number> {
    const value = await this.getValue(key);
    return value ? Number(value) : defaultValue || 0;
  }
}
