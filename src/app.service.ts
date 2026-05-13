import { Injectable } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";
import { ConfigManagerService } from "./config/config-manager.service";

@Injectable()
export class AppService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly configManager: ConfigManagerService,
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

    return {
      status: dbStatus === 1 ? "healthy" : "unhealthy",
      database: dbStates[dbStatus] || "unknown",
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
