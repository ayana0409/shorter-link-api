import { Global, Module, Logger, OnModuleInit } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

/**
 * Global database health monitor module.
 * After the app starts (possibly with DB still reconnecting),
 * this module monitors the connection and logs status changes.
 */
@Global()
@Module({})
export class DatabaseModule implements OnModuleInit {
  constructor(@InjectConnection() private connection: Connection) {}

  onModuleInit() {
    this.connection.on("connected", () => {
      Logger.log("MongoDB connection established", "DatabaseModule");
    });

    this.connection.on("disconnected", () => {
      Logger.warn("MongoDB disconnected — reconnecting...", "DatabaseModule");
    });

    this.connection.on("error", (err) => {
      Logger.error(
        `MongoDB connection error: ${err.message}`,
        "DatabaseModule",
      );
    });

    this.connection.on("reconnected", () => {
      Logger.log("MongoDB reconnected successfully", "DatabaseModule");
    });
  }
}
