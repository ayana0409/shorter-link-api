import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ConfigManagerService } from "./config/config-manager.service";
import { RedisService } from "./redis";

@Injectable()
export class AppService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configManager: ConfigManagerService,
    private readonly redisService: RedisService,
  ) {}

  getHello(): string {
    return "Hello World!";
  }

  ping(): { status: string } {
    return { status: "ok" };
  }

  async health(): Promise<{
    status: string;
    database: string;
    redis: {
      connected: boolean;
      pendingNotifications: number;
      queue: {
        listCount: number;
        dedupKeyCount: number;
        total: number;
      };
      cache: {
        totalKeys: number;
        estimatedMemoryKB: number;
        shortUrl: { count: number };
        userPermissions: { count: number };
        dailyCount: { count: number };
        config: { count: number };
      };
    };
    uptime: number;
    timestamp: string;
    rateLimit: { ttl: number; limit: number };
    memory: { used: number; total: number; unit: string };
  }> {
    const dbStatus = this.connection.readyState;
    const dbStates: Record<number, string> = {
      0: "disconnected",
      1: "connected",
      2: "connecting",
      3: "disconnecting",
    };

    const rateLimitTtl = await this.configManager.getNumberValue(
      "RATE_LIMIT_TTL",
      60000,
    );
    const rateLimitMax = await this.configManager.getNumberValue(
      "RATE_LIMIT_MAX",
      100,
    );

    const memUsage = process.memoryUsage();
    const usedMB = Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100;
    const totalMB = Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100;

    const redisConnected = await this.redisService.ping();
    const pendingNotifications =
      await this.redisService.getPendingNotificationCount();

    let queueStats = {
      listCount: 0,
      dedupKeyCount: 0,
      total: pendingNotifications,
    };

    // Cache stats (only if Redis is connected)
    let cacheStats = {
      totalKeys: 0,
      estimatedMemoryKB: 0,
      shortUrl: { count: 0 },
      userPermissions: { count: 0 },
      dailyCount: { count: 0 },
      config: { count: 0 },
    };

    if (redisConnected) {
      try {
        const stats = await this.redisService.getCacheStats();
        cacheStats = {
          totalKeys: stats.totalKeys,
          estimatedMemoryKB: Math.round(stats.estimatedMemoryBytes / 1024),
          shortUrl: { count: stats.shortUrl.count },
          userPermissions: { count: stats.userPermissions.count },
          dailyCount: { count: stats.dailyCount.count },
          config: { count: stats.config.count },
        };
      } catch {
        // ignore cache stats errors
      }

      try {
        queueStats = await this.redisService.getPendingNotificationQueueStats();
      } catch {
        queueStats = {
          listCount: 0,
          dedupKeyCount: 0,
          total: pendingNotifications,
        };
      }
    }

    return {
      status: dbStatus === 1 && redisConnected ? "healthy" : "unhealthy",
      database: dbStates[dbStatus] || "unknown",
      redis: {
        connected: redisConnected,
        pendingNotifications,
        queue: queueStats,
        cache: cacheStats,
      },
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      rateLimit: {
        ttl: rateLimitTtl,
        limit: rateLimitMax,
      },
      memory: {
        used: usedMB,
        total: totalMB,
        unit: "MB",
      },
    };
  }
}
