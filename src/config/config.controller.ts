import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { ConfigManagerService } from "./config-manager.service";
import { AuthGuard } from "../auth/auth.guard";
import { AdminGuard } from "../auth/admin.guard";
import { UpdateConfigDto } from "./dto/update-config.dto";

@Controller("config")
export class ConfigController {
  constructor(private readonly configManagerService: ConfigManagerService) {}

  @Get()
  @UseGuards(AuthGuard, AdminGuard)
  async getAllConfigs() {
    return this.configManagerService.getAll();
  }

  @Get(":key")
  @UseGuards(AuthGuard, AdminGuard)
  async getConfig(@Param("key") key: string) {
    const value = await this.configManagerService.getByKey(key);
    if (!value) {
      throw new BadRequestException(`Config key "${key}" not found`);
    }
    return { key, value };
  }

  @Patch(":key")
  @UseGuards(AuthGuard, AdminGuard)
  async updateConfig(
    @Param("key") key: string,
    @Body() updateConfigDto: UpdateConfigDto,
  ) {
    const allowedKeys = [
      "DAILY_SHORTEN_LIMIT",
      "SHORT_URL_LENGTH",
      "SHORT_URL_EXPIRATION_DAYS",
      "MONGO_DB_CONNECTIONSTRING",
      "MAX_GROUPS_COUNT",
      "MAX_MEMBERS_PER_GROUP",
      "RATE_LIMIT_TTL",
      "RATE_LIMIT_MAX",
    ];

    if (!allowedKeys.includes(key)) {
      throw new BadRequestException(
        `Cannot update config key "${key}". Allowed keys: ${allowedKeys.join(", ")}`,
      );
    }

    // Validate type
    if (updateConfigDto.type === "number") {
      const num = Number(updateConfigDto.value);
      if (isNaN(num)) {
        throw new BadRequestException(
          `Value must be a valid number for key "${key}"`,
        );
      }
    }

    const updated = await this.configManagerService.updateByKey(
      key,
      updateConfigDto,
    );

    if (!updated) {
      throw new BadRequestException(`Config key "${key}" not found`);
    }

    return updated;
  }
}
