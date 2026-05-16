import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { AuthGuard } from "./auth.guard";
import { Request } from "express";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() user: LoginDto) {
    return this.authService.login(user);
  }

  @Post("refresh")
  async refresh(@Body() body: RefreshTokenDto, @Req() req: Request) {
    // Extract username from the expired access token if provided,
    // otherwise require it in the body
    const username = body["username"] as string;
    if (!username) {
      throw new (await import("@nestjs/common")).UnauthorizedException(
        "Username is required for refresh",
      );
    }
    return this.authService.refreshTokens(body.refresh_token, username);
  }

  @Post("logout")
  @UseGuards(AuthGuard)
  async logout(@Body() body: RefreshTokenDto, @Req() req: Request) {
    const user = req["user"];
    return this.authService.logout(body.refresh_token, user.username);
  }
}
