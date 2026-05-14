import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose/dist";
import { Model } from "mongoose";
import { Config } from "./schemas/config.schema";
import { ConfigService as NestConfigService } from "@nestjs/config";
import { UpdateConfigDto } from "./dto/update-config.dto";
import { I18nService } from "../common/i18n";

@Injectable()
export class ConfigManagerService {
  constructor(
    @InjectModel(Config.name) private configModel: Model<Config>,
    private configService: NestConfigService,
    private i18n: I18nService,
  ) {
    this.initializeDefaultConfigs();
  }

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
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
    // Try to get from DB first
    const config = await this.configModel.findOne({ key }).exec();
    if (config) {
      return config.value;
    }

    // Fallback to .env
    const envValue = this.configService.get<string>(key);
    return envValue ?? null; // Convert undefined to null
  }

  async updateByKey(key: string, updateConfigDto: UpdateConfigDto) {
    // Skip allowedKeys check since the controller already handles it
    return this.configModel
      .findOneAndUpdate({ key }, updateConfigDto, { new: true, upsert: false })
      .exec();
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
