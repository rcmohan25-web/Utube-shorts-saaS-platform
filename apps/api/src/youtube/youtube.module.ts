import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { YoutubeService } from './youtube.service';
import { YoutubeOAuthService } from './youtube-oauth.service';

// Registers its own JwtModule (same JWT_SECRET as AuthModule) purely to
// sign/verify the short-lived OAuth "state" token in YoutubeOAuthService.
// This avoids a circular AuthModule <-> YoutubeModule import while both
// sides can still verify each other's tokens — HMAC verification only needs
// a matching secret, not a shared JwtService instance.
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') ?? 'dev-secret-change-me',
      }),
    }),
  ],
  providers: [YoutubeService, YoutubeOAuthService],
  exports: [YoutubeService, YoutubeOAuthService],
})
export class YoutubeModule {}
