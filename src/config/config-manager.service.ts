import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose/dist";
import { Model } from "mongoose";
import { Config } from "./schemas/config.schema";
import { ConfigService as NestConfigService } from "@nestjs/config";
import { UpdateConfigDto } from "./dto/update-config.dto";

@Injectable()
export class ConfigManagerService {
  constructor(
    @InjectModel(Config.name) private configModel: Model<Config>,
    private configService: NestConfigService,
  ) {
    this.initializeDefaultConfigs();
  }

  private async initializeDefaultConfigs() {
    const defaultConfigs = [
      {
        key: "DAILY_SHORTEN_LIMIT",
        value: this.configService.get<string>("DAILY_SHORTEN_LIMIT", "10"),
        description: "Số lượt tạo link tối đa mỗi ngày cho người dùng thường",
        type: "number",
      },
      {
        key: "SHORT_URL_LENGTH",
        value: this.configService.get<string>("SHORT_URL_LENGTH", "6"),
        description: "Độ dài của URL rút gọn",
        type: "number",
      },
      {
        key: "SHORT_URL_EXPIRATION_DAYS",
        value: this.configService.get<string>(
          "SHORT_URL_EXPIRATION_DAYS",
          "300",
        ),
        description: "Thời gian hết hạn của link rút gọn (tính bằng phút)",
        type: "number",
      },
      {
        key: "MONGO_DB_CONNECTIONSTRING",
        value: this.configService.get<string>(
          "MONGO_DB_CONNECTIONSTRING",
          "mongodb://localhost:27017/shorter-link",
        ),
        description: "Chuỗi kết nối cơ sở dữ liệu MongoDB",
        type: "string",
        isHidden: true,
      },
      {
        key: "MAX_GROUPS_COUNT",
        value: this.configService.get<string>("MAX_GROUPS_COUNT", "5"),
        description: "Số nhóm tối đa mà mỗi người dùng có thể tạo",
        type: "number",
      },
      {
        key: "MAX_MEMBERS_PER_GROUP",
        value: this.configService.get<string>("MAX_MEMBERS_PER_GROUP", "10"),
        description: "Số thành viên tối đa trong một nhóm",
        type: "number",
      },
      {
        key: "MAX_LINKS_PER_GROUP",
        value: this.configService.get<string>("MAX_LINKS_PER_GROUP", "20"),
        description: "Số link tối đa trong một nhóm",
        type: "number",
      },
      {
        key: "RATE_LIMIT_TTL",
        value: this.configService.get<string>("RATE_LIMIT_TTL", "60000"),
        description: "Thời gian giới hạn rate limit (ms)",
        type: "number",
      },
      {
        key: "RATE_LIMIT_MAX",
        value: this.configService.get<string>("RATE_LIMIT_MAX", "100"),
        description: "Số request tối đa trong khoảng thời gian rate limit",
        type: "number",
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
    return envValue ?? null; // Chuyển undefined thành null
  }

  async updateByKey(key: string, updateConfigDto: UpdateConfigDto) {
    // Bỏ kiểm tra allowedKeys vì controller đã xử lý
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
