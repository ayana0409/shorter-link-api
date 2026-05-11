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

import { buildSort, paginateModel } from "../common/pagination";
import { AccountService } from "../account/account.service";
dotenv.config();

@Injectable()
export class ShortenerService {
  constructor(
    @InjectModel(Shortener.name) private shortenerModel: Model<Shortener>,
    private configService: ConfigService,
    private configManagerService: ConfigManagerService,
    private accountService: AccountService,
  ) {}

  async create(createShortenerDto: CreateShortenerDto) {
    const { originalUrl, userId } = createShortenerDto;

    // Check password permission
    if (createShortenerDto.password && !(await this.canUsePassword(userId))) {
      throw new BadRequestException(
        "Your current level does not allow password protection for links.",
      );
    }

    // Check custom expiration permission
    if (
      createShortenerDto.validityToDate &&
      !(await this.canUseCustomExpiration(userId))
    ) {
      throw new BadRequestException(
        "Your current level does not allow custom expiration dates for links.",
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

  async getDailyShortenerLimit(userId?: string): Promise<number> {
    if (!userId) {
      return this.configManagerService.getNumberValue(
        "DAILY_SHORTEN_LIMIT",
        10,
      );
    }

    const account = await this.accountService.findOne(userId);
    if (
      account.level &&
      (!account.levelExpirationDate || account.levelExpirationDate > new Date())
    ) {
      return account.level.dailyShortenLimit;
    }

    return this.configManagerService.getNumberValue("DAILY_SHORTEN_LIMIT", 10);
  }

  async canUsePassword(userId?: string): Promise<boolean> {
    if (!userId) return false;

    const account = await this.accountService.findOne(userId);
    if (
      account.level &&
      (!account.levelExpirationDate || account.levelExpirationDate > new Date())
    ) {
      return account.level.allowPassword;
    }

    return false;
  }

  async canUseCustomExpiration(userId?: string): Promise<boolean> {
    if (!userId) return false;

    const account = await this.accountService.findOne(userId);
    if (
      account.level &&
      (!account.levelExpirationDate || account.levelExpirationDate > new Date())
    ) {
      return account.level.allowCustomExpiration;
    }

    return false;
  }

  async countDailyCreatedByUser(userId: string): Promise<number> {
    if (!userId) {
      return 0;
    }
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return this.shortenerModel
      .countDocuments({
        userId,
        createdAt: { $gte: startOfToday },
      })
      .exec();
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
      throw new Error("Invalid from date");
    }
    if (Number.isNaN(endDate.getTime())) {
      throw new Error("Invalid to date");
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
    return {
      ...result,
      passwordProtected: Boolean(password),
    };
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
      throw new NotFoundException("Short link not found or expired");
    }

    if (doc.password) {
      if (!password) {
        throw new BadRequestException(
          "Vui lòng nhập mật khẩu để truy cập liên kết này",
        );
      }
      const isMatch = await bcrypt.compare(password, doc.password);
      if (!isMatch) {
        throw new BadRequestException("Mật khẩu không đúng");
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
    return this.shortenerModel
      .findByIdAndUpdate(id, updateShortenerDto, { new: true })
      .exec();
  }

  async remove(id: string) {
    return this.shortenerModel.findByIdAndDelete(id).exec();
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
}
