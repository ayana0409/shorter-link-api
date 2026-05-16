import { Body, Controller, Post, Req, Res, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { AuthGuard } from "./auth.guard";
import { Request, Response } from "express";
import { ConfigService } from "@nestjs/config";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post("login")
  async login(
    @Body() user: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(user);
    // Set refresh token as HttpOnly Secure cookie
    this.setRefreshTokenCookie(res, result.refresh_token);
    // Return access token in body (refresh token is in cookie)
    return {
      access_token: result.access_token,
      expires_in: result.expires_in,
      user: result.user,
    };
  }

  @Post("refresh")
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Read refresh token from HttpOnly cookie first, fallback to body
    const refreshToken = req.cookies?.refresh_token || body.refresh_token;
    if (!refreshToken) {
      throw new (await import("@nestjs/common")).UnauthorizedException(
        "Refresh token is required",
      );
    }

    const username = body["username"] as string;
    if (!username) {
      throw new (await import("@nestjs/common")).UnauthorizedException(
        "Username is required for refresh",
      );
    }

    const result = await this.authService.refreshTokens(refreshToken, username);

    // Rotate refresh token cookie
    this.setRefreshTokenCookie(res, result.refresh_token);

    return {
      access_token: result.access_token,
      expires_in: result.expires_in,
    };
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(
    @Body() body: RefreshTokenDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = req["user"];
    const refreshToken = req.cookies?.refresh_token || body.refresh_token;
    if (refreshToken) {
      await this.authService.logout(refreshToken, user.username);
    }
    // Clear the refresh token cookie
    this.clearRefreshTokenCookie(res);
  }

  /**
   * Set refresh token as HttpOnly Secure SameSite cookie
   */
  private setRefreshTokenCookie(res: Response, refreshToken: string) {
    const isProduction =
      this.configService.get<string>("NODE_ENV") === "production";
    const refreshTtlMs =
      (this.configService.get<number>("REFRESH_TOKEN_TTL") || 604800) * 1000;

    res.cookie("refresh_token", refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "strict" : "lax",
      maxAge: refreshTtlMs,
      path: "/",
    });
  }

  /**
   * Clear refresh token cookie
   */
  private clearRefreshTokenCookie(res: Response) {
    const isProduction =
      this.configService.get<string>("NODE_ENV") === "production";
    res.clearCookie("refresh_token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "strict" : "lax",
      path: "/",
    });
  }
}
