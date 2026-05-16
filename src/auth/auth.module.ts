import { forwardRef, Module, OnModuleInit } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { AccountModule } from "../account/account.module";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthGuard } from "./auth.guard";
import { AdminGuard } from "./admin.guard";
import { ManagerGuard } from "./manager.guard";

@Module({
  imports: [
    forwardRef(() => AccountModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      global: true,
      useFactory: async (configService: ConfigService) => {
        const secretKey = configService.get<string>("JWT_SECRET");
        if (!secretKey) {
          throw new Error("JWT_SECRET is not defined");
        }

        const expiresIn = configService.get<string>("ACCESS_TOKEN_TTL");
        if (!expiresIn) {
          throw new Error("ACCESS_TOKEN_TTL is not defined");
        }

        return {
          secret: secretKey,
          signOptions: { expiresIn: Number(expiresIn) },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AdminGuard, ManagerGuard],
  exports: [AuthService, AuthGuard, AdminGuard, ManagerGuard],
})
export class AuthModule implements OnModuleInit {
  constructor(private readonly authService: AuthService) {}

  async onModuleInit() {
    // Recover active sessions from existing refresh tokens on startup
    await this.authService.recoverActiveSessions();
  }
}
