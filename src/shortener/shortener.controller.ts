import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  Query,
  NotFoundException,
} from "@nestjs/common";
import { ShortenerService } from "./shortener.service";
import { CreateShortenerDto } from "./dto/create-shortener.dto";
import { UpdateShortenerDto } from "./dto/update-shortener.dto";
import { AuthGuard } from "../auth/auth.guard";
import { AccountService } from "../account/account.service";
import { AdminGuard } from "../auth/admin.guard";
import { I18nService } from "../common/i18n";

@Controller("shortener")
export class ShortenerController {
  constructor(
    private readonly shortenerService: ShortenerService,
    private readonly accountService: AccountService,
    private readonly i18n: I18nService,
  ) {}

  /** Resolve a message using the default locale */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

  @Post()
  @UseGuards(AuthGuard)
  async create(@Request() req, @Body() createShortenerDto: CreateShortenerDto) {
    const userId = req.user?._id;

    // Check and handle level expiration before creation
    await this.accountService.handleLevelExpiration(userId);

    createShortenerDto.userId = userId;

    if (req.user?.role !== "admin") {
      const limit = await this.shortenerService.getDailyShortenerLimit(userId);
      const used = await this.shortenerService.countDailyCreatedByUser(userId);
      if (used >= limit) {
        throw new BadRequestException(
          this.msg("shortener.DAILY_LIMIT_REACHED_TRY_TOMORROW", limit),
        );
      }

      // If not allowed by level, remove these fields instead of throwing error
      if (
        createShortenerDto.password &&
        !(await this.shortenerService.canUsePassword(userId))
      ) {
        delete createShortenerDto.password;
      }

      if (
        createShortenerDto.validityToDate &&
        !(await this.shortenerService.canUseCustomExpiration(userId))
      ) {
        delete createShortenerDto.validityToDate;
      }
    }

    return this.shortenerService.create(createShortenerDto);
  }

  @Get("quota")
  @UseGuards(AuthGuard)
  async getQuota(@Request() req) {
    const username = req.user?.username || "Người dùng";
    const fullName = req.user?.fullname || "Người dùng";
    const role = req.user?.role || "user";

    const userId = req.user?._id;
    await this.accountService.handleLevelExpiration(userId);
    const account = await this.accountService.findOne(userId);

    if (role === "admin") {
      return {
        username,
        fullName,
        role,
        level: account.level,
        unlimited: true,
        limit: null,
        used: 0,
        remaining: null,
      };
    }

    const limit = await this.shortenerService.getDailyShortenerLimit(
      req.user?._id,
    );
    const used = await this.shortenerService.countDailyCreatedByUser(
      req.user?._id,
    );
    const remaining = Math.max(limit - used, 0);

    return {
      username,
      fullName,
      role,
      level: account.level,
      unlimited: false,
      limit,
      used,
      remaining,
    };
  }

  @Get("analytics")
  @UseGuards(AuthGuard)
  async getAnalytics(
    @Request() req,
    @Query("range") range = "daily",
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.shortenerService.getLinkCreationStats(
      req.user?._id,
      range,
      from,
      to,
    );
  }

  @Get("analytics/admin")
  @UseGuards(AuthGuard, AdminGuard)
  async getAdminAnalytics(
    @Query("range") range = "daily",
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.shortenerService.getLinkCreationStats(null, range, from, to);
  }

  @Get()
  findAll() {
    return this.shortenerService.findAll();
  }

  @Get("user")
  @UseGuards(AuthGuard)
  async findByUserId(
    @Request() req,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("sortBy") sortBy = "createdAt",
    @Query("sortOrder") sortOrder = "desc",
    @Query("page") page = "1",
    @Query("limit") limit = "5",
  ) {
    const pageNumber = Number(page) || 1;
    const limitNumber = Number(limit) || 5;
    const links = await this.shortenerService.findByUserId(
      req.user._id,
      search,
      status,
      sortBy,
      sortOrder,
      pageNumber,
      limitNumber,
    );
    const totalLinks = await this.shortenerService.countByUserId(
      req.user._id,
      search,
      status,
    );
    const totalPages = Math.max(1, Math.ceil(totalLinks / limitNumber));
    return {
      data: links,
      page: pageNumber,
      totalPages,
    };
  }

  @Get(":shortUrl")
  async findByShortUrl(@Param("shortUrl") shortUrl: string) {
    const result = await this.shortenerService.findByShortUrl(shortUrl);
    if (!result) {
      throw new NotFoundException(
        this.msg("shortener.SHORT_LINK_NOT_FOUND_OR_EXPIRED"),
      );
    }
    return result;
  }

  @Post(":shortUrl/click")
  async validateClick(
    @Param("shortUrl") shortUrl: string,
    @Body("password") password?: string,
  ) {
    return this.shortenerService.validateAndIncrementClick(shortUrl, password);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() updateShortenerDto: UpdateShortenerDto,
  ) {
    return this.shortenerService.update(id, updateShortenerDto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.shortenerService.remove(id);
  }
}
