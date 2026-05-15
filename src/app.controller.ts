import { Controller, Get, Post, Body, Req, Res } from "@nestjs/common";
import { AppService } from "./app.service";
import { Response } from "express";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("ping")
  ping() {
    return this.appService.ping();
  }

  @Get("health")
  health() {
    return this.appService.health();
  }

  @Post("admin/redis/flush")
  async flushCacheEndpoint(@Res() res: Response) {
    const success = await this.appService.flushCache();
    if (success) {
      return res.json({ status: "ok", message: "Cache flushed successfully" });
    }
    return res.status(500).json({ status: "error", message: "Flush failed" });
  }
}
