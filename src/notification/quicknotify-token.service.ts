import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigManagerService } from '../config/config-manager.service';

@Injectable()
export class QuickNotifyTokenService {
  private readonly logger = new Logger(QuickNotifyTokenService.name);
  private readonly PROJECT_ID = 'shorterlink';

  constructor(
    private readonly jwtService: JwtService,
    private readonly configManager: ConfigManagerService,
  ) {}

  /**
   * Generate a signed HS256 JWT for QuickNotify WebSocket authentication.
   * Claims include project_id, user_id, and exp timestamp.
   */
  async generateToken(
    userId: string,
    expiresIn: string | number = '24h',
  ): Promise<string> {
    const envSecret = process.env.QUICKNOTIFY_JWT_SECRET;
    const secret =
      envSecret ||
      (await this.configManager.getValue(
        'QUICKNOTIFY_JWT_SECRET',
        'quicknotify_dev_secret_key_2026',
      ));

    const payload = {
      project_id: this.PROJECT_ID,
      user_id: userId,
    };

    this.logger.debug(
      `Generating QuickNotify JWT token for user ${userId} under project ${this.PROJECT_ID}`,
    );

    return this.jwtService.sign(payload, {
      secret,
      expiresIn: expiresIn as any,
      algorithm: 'HS256',
    });
  }
}
