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
import { I18nService } from "../common/i18n";

@Controller("config")
export class ConfigController {
  constructor(
    private readonly configManagerService: ConfigManagerService,
    private i18n: I18nService,
  ) {}

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

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
      throw new BadRequestException(this.msg("config.KEY_NOT_FOUND", key));
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
      "MAX_LINKS_PER_GROUP",
      "RATE_LIMIT_TTL",
      "RATE_LIMIT_MAX",
      "REDIS_HOST",
      "REDIS_PORT",
      "REDIS_USERNAME",
      "REDIS_PASSWORD",
      "ACCESS_TOKEN_TTL",
      "REFRESH_TOKEN_TTL",
      "WS_URL",
    ];

    if (!allowedKeys.includes(key)) {
      throw new BadRequestException(
        this.msg("config.KEY_NOT_ALLOWED", key, allowedKeys.join(", ")),
      );
    }

    // Validate type
    if (updateConfigDto.type === "number") {
      const num = Number(updateConfigDto.value);
      if (isNaN(num)) {
        throw new BadRequestException(
          this.msg("config.INVALID_NUMBER_VALUE", key),
        );
      }
    }

    const updated = await this.configManagerService.updateByKey(
      key,
      updateConfigDto,
    );

    if (!updated) {
      throw new BadRequestException(this.msg("config.KEY_NOT_FOUND", key));
    }

    return updated;
  }
}
