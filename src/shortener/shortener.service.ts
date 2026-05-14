import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose/dist";
import { CreateShortenerDto } from "./dto/create-shortener.dto";
import { UpdateShortenerDto } from "./dto/update-shortener.dto";
import { Shortener } from "./schema/shortener.schema";
import { Model, Types } from "mongoose";
import { ConfigService } from "@nestjs/config";
import * as dotenv from "dotenv";
import * as bcrypt from "bcrypt";
import axios from "axios";
import * as cheerio from "cheerio";
import * as he from "he";
import { ConfigManagerService } from "../config/config-manager.service";
import { I18nService } from "../common/i18n";
import { AccountService } from "../account/account.service";
import { RedisService } from "../redis";
import { ModuleRef as NestModuleRef } from "@nestjs/core";
dotenv.config();

@Injectable()
export class ShortenerService {
  private redisCache: RedisService | null = null;

  constructor(
    @InjectModel(Shortener.name) private shortenerModel: Model<Shortener>,
    private configService: ConfigService,
    private configManagerService: ConfigManagerService,
    private accountService: AccountService,
    private i18n: I18nService,
    private moduleRef: NestModuleRef,
  ) {}

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

  /** Resolve a message using the default locale */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
  }

  private async withRedis<T>(
    fn: (redis: RedisService) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    if (!this.redis) return fallback;
    try {
      return await fn(this.redis);
    } catch {
      return fallback;
    }
  }

  async create(createShortenerDto: CreateShortenerDto) {
    const { originalUrl, userId } = createShortenerDto;

    // Check password permission
    if (createShortenerDto.password && !(await this.canUsePassword(userId))) {
      throw new BadRequestException(this.msg("shortener.PASSWORD_NOT_ALLOWED"));
    }

    // Check custom expiration permission
    if (
      createShortenerDto.validityToDate &&
      !(await this.canUseCustomExpiration(userId))
    ) {
      throw new BadRequestException(
        this.msg("shortener.CUSTOM_EXPIRATION_NOT_ALLOWED"),
      );
    }

    const shortUrlLength = await this.configManagerService.getNumberValue(
      "SHORT_URL_LENGTH",
      6,
    );
    const shortUrlExpirationMinutes =
      await this.configManagerService.getNumberValue(
        "SHORT_URL_EXPIRATION_DAYS",
        300,
      );

    const shortUrl = await this.generateUniqueShortUrl(shortUrlLength);

    let expirationDate: Date | undefined;

    // Determine expiration date based on noExpiration flag and validityToDate
    if (createShortenerDto.noExpiration) {
      expirationDate = undefined;
    } else if (createShortenerDto.validityToDate) {
      expirationDate = new Date(createShortenerDto.validityToDate);
    } else {
      expirationDate = new Date();
      expirationDate.setMinutes(
        expirationDate.getMinutes() + shortUrlExpirationMinutes,
      );
    }

    const passwordHash = createShortenerDto.password
      ? await bcrypt.hash(createShortenerDto.password, await bcrypt.genSalt(10))
      : undefined;

    const shortener = new this.shortenerModel({
      originalUrl,
      shortUrl,
      siteName: createShortenerDto.siteName ?? null,
      password: passwordHash,
      clicks: 0,
      status: "active",
      expiresAt: expirationDate,
      validityFromDate: createShortenerDto.validityFromDate ?? null,
      validityToDate: createShortenerDto.validityToDate ?? null,
      noExpiration: createShortenerDto.noExpiration ?? false,
      userId: createShortenerDto.userId ?? null,
    });

    const saved = await shortener.save();

    // Invalidate daily count cache for this user
    if (userId && this.redis) {
      try {
        await this.redis.del(`daily_count:${userId}:${this.todayKey()}`);
      } catch {
        /* ignore */
      }
    }

    if (!createShortenerDto.siteName) {
      this.fetchPageTitle(originalUrl)
        .then((siteName) => {
          if (siteName) {
            return this.shortenerModel
              .findByIdAndUpdate(saved._id, { siteName }, { new: true })
              .exec();
          }
          return null;
        })
        .catch(() => null);
    }

    return saved;
  }

  async findAll() {
    const docs = await this.shortenerModel
      .find()
      .select("+password")
      .lean()
      .exec();
    return docs.map(({ password, ...doc }) => ({
      ...doc,
      passwordProtected: Boolean(password),
    }));
  }

  async findOne(id: string) {
    const doc = await this.shortenerModel
      .findById(id)
      .select("+password")
      .lean()
      .exec();
    if (!doc) return null;
    const { password, ...result } = doc;
    return { ...result, passwordProtected: Boolean(password) };
  }

  private buildUserQuery(userId: string, search?: string, status?: string) {
    const query: any = { userId };

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [
        { siteName: regex },
        { originalUrl: regex },
        { shortUrl: regex },
      ];
    }

    if (status && status !== "all") {
      if (status === "valid") {
        query.status = "active";
        query.$or = [
          { noExpiration: true },
          { expiresAt: { $gt: new Date() } },
        ];
      } else if (status === "expired") {
        query.status = { $ne: "disabled" };
        query.noExpiration = false;
        query.expiresAt = { $lte: new Date() };
      } else if (status === "disabled") {
        query.status = "disabled";
      }
    }

    return query;
  }

  private buildSort(sortBy = "createdAt", sortOrder = "desc") {
    const sort: any = {};
    sort[sortBy] = sortOrder === "asc" ? 1 : -1;
    return sort;
  }

  private paginateQuery(query: any, sort: any, page = 1, limit = 5) {
    const skip = (page - 1) * limit;
    return this.shortenerModel
      .find(query)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async findByUserId(
    userId: string,
    search?: string,
    status?: string,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = 1,
    limit = 5,
  ) {
    const query = this.buildUserQuery(userId, search, status);
    const sort = this.buildSort(sortBy, sortOrder);
    const links = await this.shortenerModel
      .find(query)
      .select("+password")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec();

    return links.map(({ password, ...link }) => ({
      ...link,
      passwordProtected: Boolean(password),
    }));
  }

  async countByUserId(userId: string, search?: string, status?: string) {
    const query = this.buildUserQuery(userId, search, status);
    return this.shortenerModel.countDocuments(query).exec();
  }

  private buildIdsQuery(ids: string[], search?: string, status?: string) {
    const query: any = { _id: { $in: ids } };

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [
        { siteName: regex },
        { originalUrl: regex },
        { shortUrl: regex },
      ];
    }

    if (status && status !== "all") {
      if (status === "valid") {
        query.status = "active";
        query.$or = [
          { noExpiration: true },
          { expiresAt: { $gt: new Date() } },
        ];
      } else if (status === "expired") {
        query.status = { $ne: "disabled" };
        query.noExpiration = false;
        query.expiresAt = { $lte: new Date() };
      } else if (status === "disabled") {
        query.status = "disabled";
      }
    }

    return query;
  }

  async findByIds(
    ids: string[],
    search?: string,
    status?: string,
    sortBy = "createdAt",
    sortOrder = "desc",
    page = 1,
    limit = 5,
  ) {
    const query = this.buildIdsQuery(ids, search, status);
    const sort = this.buildSort(sortBy, sortOrder);
    const links = await this.shortenerModel
      .find(query)
      .select("+password")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
      .exec();

    return links.map(({ password, ...link }) => ({
      ...link,
      passwordProtected: Boolean(password),
    }));
  }

  async countByIds(ids: string[], search?: string, status?: string) {
    const query = this.buildIdsQuery(ids, search, status);
    return this.shortenerModel.countDocuments(query).exec();
  }

  /**
   * Get cached user permissions (level info) — shared across all permission checks
   */
  private async getUserPermissions(userId: string) {
    const cacheKey = `user:perm:${userId}`;
    const cached = await this.withRedis<any | null>(
      (redis) => redis.getCachedUserPermissions(cacheKey),
      null,
    );
    if (cached) return cached;

    const account = await this.accountService.findOne(userId);
    const permissions = {
      dailyShortenLimit: 10,
      allowPassword: false,
      allowCustomExpiration: false,
      maxGroupsCount: 5,
      maxMembersPerGroup: 10,
      maxLinksPerGroup: 20,
    };

    if (
      account.level &&
      (!account.levelExpirationDate || account.levelExpirationDate > new Date())
    ) {
      permissions.dailyShortenLimit = account.level.dailyShortenLimit ?? 10;
      permissions.allowPassword = account.level.allowPassword ?? false;
      permissions.allowCustomExpiration =
        account.level.allowCustomExpiration ?? false;
      permissions.maxGroupsCount = account.level.maxGroupsCount ?? 5;
      permissions.maxMembersPerGroup = account.level.maxMembersPerGroup ?? 10;
      permissions.maxLinksPerGroup = account.level.maxLinksPerGroup ?? 20;
    }

    // Cache for 5 minutes
    await this.withRedis(
      (redis) => redis.cacheUserPermissions(cacheKey, permissions),
      false,
    );
    return permissions;
  }

  async getDailyShortenerLimit(userId?: string): Promise<number> {
    if (!userId) {
      return this.configManagerService.getNumberValue(
        "DAILY_SHORTEN_LIMIT",
        10,
      );
    }
    const perms = await this.getUserPermissions(userId);
    return perms.dailyShortenLimit;
  }

  async canUsePassword(userId?: string): Promise<boolean> {
    if (!userId) return false;
    const perms = await this.getUserPermissions(userId);
    return perms.allowPassword;
  }

  async canUseCustomExpiration(userId?: string): Promise<boolean> {
    if (!userId) return false;
    const perms = await this.getUserPermissions(userId);
    return perms.allowCustomExpiration;
  }

  async getMaxGroupsCount(userId?: string): Promise<number> {
    if (!userId) {
      return this.configManagerService.getNumberValue("MAX_GROUPS_COUNT", 5);
    }
    const perms = await this.getUserPermissions(userId);
    return perms.maxGroupsCount;
  }

  async getMaxMembersPerGroup(userId?: string): Promise<number> {
    if (!userId) {
      return this.configManagerService.getNumberValue(
        "MAX_MEMBERS_PER_GROUP",
        10,
      );
    }
    const perms = await this.getUserPermissions(userId);
    return perms.maxMembersPerGroup;
  }

  async getMaxLinksPerGroup(userId?: string): Promise<number> {
    if (!userId) {
      return this.configManagerService.getNumberValue(
        "MAX_LINKS_PER_GROUP",
        20,
      );
    }
    const perms = await this.getUserPermissions(userId);
    return perms.maxLinksPerGroup;
  }

  async countDailyCreatedByUser(userId: string): Promise<number> {
    if (!userId) {
      return 0;
    }

    // Try cache first
    const todayKey = this.todayKey();
    const dailyCacheKey = `daily_count:${userId}:${todayKey}`;
    const cached = await this.withRedis<number | null>(
      (redis) => redis.get<number>(dailyCacheKey),
      null,
    );
    if (cached !== null && cached !== undefined) return cached;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const count = await this.shortenerModel
      .countDocuments({
        userId,
        createdAt: { $gte: startOfToday },
      })
      .exec();

    // Cache with TTL until midnight
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const ttlSeconds = Math.floor((midnight.getTime() - now.getTime()) / 1000);
    await this.withRedis(
      (redis) => redis.set(dailyCacheKey, count, { ttl: ttlSeconds }),
      false,
    );

    return count;
  }

  async verifyDailyLimit(userId: string, needed: number = 1) {
    const account = await this.accountService.findOne(userId);
    if (account.role === "admin") {
      return;
    }

    const limit = await this.getDailyShortenerLimit(userId);
    const used = await this.countDailyCreatedByUser(userId);
    if (used + needed > limit) {
      throw new BadRequestException(
        this.msg("shortener.DAILY_LIMIT_REACHED", limit),
      );
    }
  }

  async getLinkCreationStats(
    userId: string | null,
    range = "daily",
    from?: string,
    to?: string,
  ) {
    const now = new Date();

    const endDate = to ? new Date(to) : now;
    const startDate = from
      ? new Date(from)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(startDate.getTime())) {
      throw new Error(this.msg("shortener.INVALID_FROM_DATE"));
    }
    if (Number.isNaN(endDate.getTime())) {
      throw new Error(this.msg("shortener.INVALID_TO_DATE"));
    }

    const match: any = {};
    if (userId) {
      match.userId = userId;
    }
    if (startDate || endDate) {
      match.createdAt = {};
      if (startDate) {
        match.createdAt.$gte = startDate;
      }
      if (endDate) {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        match.createdAt.$lte = endOfDay;
      }
    }

    const summaryField =
      range === "weekly"
        ? {
            $dateToString: {
              format: "%G-W%V",
              date: "$createdAt",
              timezone: "UTC",
            },
          }
        : {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$createdAt",
              timezone: "UTC",
            },
          };

    const result = await this.shortenerModel
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: summaryField,
            count: { $sum: 1 },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ])
      .exec();

    return result.map((item) => ({ label: item._id, value: item.count }));
  }

  async findByShortUrl(shortUrl: string) {
    // Try cache first
    if (this.redis) {
      try {
        const cached = await this.redis.getCachedShortUrl(shortUrl);
        if (cached) return cached;
      } catch {
        /* ignore */
      }
    }

    const doc = await this.shortenerModel
      .findOne({
        shortUrl,
        status: "active",
        $or: [{ noExpiration: true }, { expiresAt: { $gt: new Date() } }],
      })
      .select("+password")
      .lean()
      .exec();
    if (!doc) return null;
    const { password, ...result } = doc;
    const response = {
      ...result,
      passwordProtected: Boolean(password),
    };

    // Cache with TTL based on expiration (min 60s, max 1h for no-expiration links)
    if (this.redis) {
      try {
        const ttl = doc.expiresAt
          ? Math.max(
              Math.floor(
                (new Date(doc.expiresAt).getTime() - Date.now()) / 1000,
              ),
              60,
            )
          : 3600;
        await this.redis.cacheShortUrl(shortUrl, response, ttl);
      } catch {
        /* ignore */
      }
    }

    return response;
  }

  private extractShortUrlCode(shortUrl: string): string {
    if (!shortUrl) return shortUrl;
    const match = shortUrl.match(/\/s\/([^/?#]+)/i);
    if (match && match[1]) {
      return match[1];
    }
    const parts = shortUrl.split(/[\/\\]/).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : shortUrl;
  }

  async findByShortUrlCode(shortUrl: string) {
    const code = this.extractShortUrlCode(shortUrl);
    return this.shortenerModel.findOne({ shortUrl: code }).exec();
  }

  async findByOriginalUrl(originalUrl: string) {
    return this.shortenerModel.findOne({ originalUrl }).exec();
  }

  async findExistingShorteners(links: string[], userId: string) {
    // Thêm userId vào đây
    const codes = links.map((link) => this.extractShortUrlCode(link));
    return this.shortenerModel
      .find({
        userId: userId, // Thêm điều kiện lọc theo user
        $or: [{ shortUrl: { $in: codes } }, { originalUrl: { $in: links } }],
      })
      .exec();
  }

  // Batch create shorteners for better performance
  async createBatch(
    items: Array<{ originalUrl: string; userId: string; siteName?: string }>,
  ): Promise<Shortener[]> {
    if (items.length === 0) return [];

    const userId = items[0].userId;
    const shortUrlLength = await this.configManagerService.getNumberValue(
      "SHORT_URL_LENGTH",
      6,
    );
    const shortUrlExpirationMinutes =
      await this.configManagerService.getNumberValue(
        "SHORT_URL_EXPIRATION_DAYS",
        300,
      );

    // Batch generate unique short URLs
    const shortUrls = await this.generateUniqueShortUrls(
      items.length,
      shortUrlLength,
    );

    const expirationDate = new Date();
    expirationDate.setMinutes(
      expirationDate.getMinutes() + shortUrlExpirationMinutes,
    );

    const docsToInsert = items.map((item, index) => ({
      originalUrl: item.originalUrl,
      shortUrl: shortUrls[index],
      siteName: item.siteName ?? null,
      clicks: 0,
      status: "active",
      expiresAt: expirationDate,
      userId: item.userId,
    }));

    const created = await this.shortenerModel.insertMany(docsToInsert);

    // Fetch page titles asynchronously (fire-and-forget)
    items.forEach((item, index) => {
      if (!item.siteName) {
        this.fetchPageTitle(item.originalUrl)
          .then((siteName) => {
            if (siteName) {
              return this.shortenerModel
                .findByIdAndUpdate(created[index]._id, { siteName })
                .exec();
            }
            return null;
          })
          .catch(() => null);
      }
    });

    return created as any as Shortener[];
  }

  // Batch generate unique short URLs with single DB query
  async generateUniqueShortUrls(
    count: number,
    length: number,
  ): Promise<string[]> {
    const shortUrls: string[] = [];
    const existingCodes = new Set<string>();

    while (shortUrls.length < count) {
      const needed = count - shortUrls.length;
      const candidates: string[] = [];

      // Generate candidates with 20% buffer
      const bufferSize = Math.ceil(needed * 1.2);
      for (let i = 0; i < bufferSize; i++) {
        candidates.push(this.generateShortUrl(length));
      }

      // Batch check all candidates in single query
      const existing = await this.shortenerModel
        .find({ shortUrl: { $in: candidates } })
        .select("shortUrl")
        .lean()
        .exec();

      existing.forEach((doc) => existingCodes.add(doc.shortUrl));

      // Filter out existing codes
      for (const code of candidates) {
        if (!existingCodes.has(code) && shortUrls.length < count) {
          shortUrls.push(code);
          existingCodes.add(code);
        }
      }
    }

    return shortUrls;
  }

  async attachGroupsToShorteners(shortenerIds: string[], groupId: string) {
    await this.shortenerModel
      .updateMany(
        { _id: { $in: shortenerIds.map((id) => new Types.ObjectId(id)) } },
        { $addToSet: { groupIds: new Types.ObjectId(groupId) } },
      )
      .exec();
  }

  async detachGroupFromShorteners(groupId: string) {
    await this.shortenerModel
      .updateMany(
        { groupIds: new Types.ObjectId(groupId) },
        { $pull: { groupIds: new Types.ObjectId(groupId) } },
      )
      .exec();
  }

  async detachGroupFromShortener(shortenerId: string, groupId: string) {
    await this.shortenerModel
      .updateOne(
        { _id: new Types.ObjectId(shortenerId) },
        { $pull: { groupIds: new Types.ObjectId(groupId) } },
      )
      .exec();
  }

  async validateAndIncrementClick(shortUrl: string, password?: string) {
    const doc = await this.shortenerModel
      .findOne({
        shortUrl,
        status: "active",
        $or: [{ noExpiration: true }, { expiresAt: { $gt: new Date() } }],
      })
      .select("+password")
      .exec();

    if (!doc) {
      throw new NotFoundException(
        this.msg("shortener.SHORT_LINK_NOT_FOUND_OR_EXPIRED"),
      );
    }

    if (doc.password) {
      if (!password) {
        throw new BadRequestException(this.msg("shortener.PASSWORD_REQUIRED"));
      }
      const isMatch = await bcrypt.compare(password, doc.password);
      if (!isMatch) {
        throw new BadRequestException(this.msg("shortener.PASSWORD_INCORRECT"));
      }
    }

    const updated = await this.shortenerModel
      .findByIdAndUpdate(doc._id, { $inc: { clicks: 1 } }, { new: true })
      .select("-password")
      .lean()
      .exec();

    return {
      ...(updated || {}),
      originalUrl: doc.originalUrl,
      passwordProtected: Boolean(doc.password),
    };
  }

  async update(id: string, updateShortenerDto: UpdateShortenerDto) {
    if (updateShortenerDto.password) {
      updateShortenerDto.password = await bcrypt.hash(
        updateShortenerDto.password,
        await bcrypt.genSalt(10),
      );
    }
    const updated = await this.shortenerModel
      .findByIdAndUpdate(id, updateShortenerDto, { new: true })
      .lean()
      .exec();

    // Invalidate short URL cache
    if (updated?.shortUrl) {
      await this.withRedis(
        (redis) => redis.invalidateShortUrl(updated.shortUrl),
        false,
      );
    }

    return updated;
  }

  async remove(id: string) {
    const doc = await this.shortenerModel.findById(id).lean().exec();
    const result = await this.shortenerModel.findByIdAndDelete(id).exec();

    // Invalidate short URL cache
    if (doc?.shortUrl) {
      await this.withRedis(
        (redis) => redis.invalidateShortUrl(doc.shortUrl),
        false,
      );
    }
    // Invalidate daily count cache
    if (doc?.userId) {
      await this.withRedis(
        (redis) => redis.del(`daily_count:${doc.userId}:${this.todayKey()}`),
        false,
      );
    }

    return result;
  }

  async generateUniqueShortUrl(length: number): Promise<string> {
    let shortUrl: string = "";
    let exists = true;

    while (exists) {
      shortUrl = this.generateShortUrl(length);
      exists = (await this.shortenerModel.findOne({ shortUrl }).exec()) != null;
    }

    return shortUrl;
  }

  private normalizeUrl(url: string): string {
    if (!/^https?:\/\//i.test(url)) {
      return `http://${url}`;
    }
    return url;
  }

  private async fetchPageTitle(url: string): Promise<string | null> {
    try {
      const res = await axios.get(url, {
        timeout: 5000,
        maxRedirects: 5,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36",
        },
        responseType: "text",
        decompress: true,
      });

      const html = res.data;
      const $ = cheerio.load(html);

      // Ưu tiên OG
      let title =
        $('meta[property="og:title"]').attr("content") ||
        $('meta[name="og:title"]').attr("content") ||
        $('meta[name="twitter:title"]').attr("content") ||
        $("title").text();

      if (!title) return null;

      return he.decode(title.trim());
    } catch {
      return null;
    }
  }

  private generateShortUrl(length: number): string {
    const characters =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let shortUrl = "";

    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * characters.length);
      shortUrl += characters[randomIndex];
    }

    return shortUrl;
  }

  private todayKey(): string {
    return new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  }
}
