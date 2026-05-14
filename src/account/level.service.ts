import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Level, LevelDocument } from "./schemas/level.schema";
import { CreateLevelDto } from "./dto/create-level.dto";
import { UpdateLevelDto } from "./dto/update-level.dto";
import {
  buildSearchQuery,
  buildSort,
  paginateModel,
} from "../common/pagination";
import { I18nService } from "../common/i18n";
import { RedisService } from "../redis";
import { ModuleRef } from "@nestjs/core";

@Injectable()
export class LevelService {
  private redisCache: RedisService | null = null;

  constructor(
    @InjectModel(Level.name) private levelModel: Model<LevelDocument>,
    private i18n: I18nService,
    private moduleRef: ModuleRef,
  ) {}

  /**
   * Helper to resolve a message using the default locale
   */
  private msg(keyPath: string, ...args: any[]): string {
    return this.i18n.t(this.i18n.defaultLocale, keyPath, ...args);
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

  private async execRedis(
    fn: (redis: RedisService) => Promise<void>,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await fn(this.redis);
    } catch {
      // ignore Redis failures
    }
  }

  async create(createLevelDto: CreateLevelDto): Promise<Level> {
    const createdLevel = new this.levelModel(createLevelDto);
    return createdLevel.save();
  }

  async findAll(): Promise<Level[]> {
    return this.levelModel.find().exec();
  }

  async findAllPaginated(
    search?: string,
    sortBy = "name",
    sortOrder = "asc",
    page = 1,
    limit = 10,
  ) {
    const query = buildSearchQuery(search, ["name"]);
    const sort = buildSort(sortBy, sortOrder);

    const levels = await paginateModel(
      this.levelModel,
      query,
      sort,
      page,
      limit,
    );
    const total = await this.levelModel.countDocuments(query).exec();

    return { levels, total };
  }

  async findOne(id: string): Promise<Level> {
    const level = await this.levelModel.findById(id).exec();
    if (!level) {
      throw new NotFoundException(this.msg("level.NOT_FOUND", id));
    }
    return level;
  }

  async update(id: string, updateLevelDto: UpdateLevelDto): Promise<Level> {
    const updatedLevel = await this.levelModel
      .findByIdAndUpdate(id, updateLevelDto, { new: true })
      .exec();
    if (!updatedLevel) {
      throw new NotFoundException(this.msg("level.NOT_FOUND", id));
    }
    // Invalidate all user permissions cache (level permissions changed)
    await this.execRedis((redis) => redis.invalidateAllUserPermissions());
    return updatedLevel;
  }

  async remove(id: string): Promise<void> {
    const result = await this.levelModel.findByIdAndDelete(id).exec();
    if (!result) {
      throw new NotFoundException(this.msg("level.NOT_FOUND", id));
    }
    // Invalidate all user permissions cache (level permissions changed)
    await this.execRedis((redis) => redis.invalidateAllUserPermissions());
  }
}
