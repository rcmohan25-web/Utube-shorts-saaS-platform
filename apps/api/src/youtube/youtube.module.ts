import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { YoutubeService } from './youtube.service';
import { YoutubeOAuthService } from './youtube-oauth.service';
import { YoutubeTokenService } from './youtube-token.service';

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
  providers: [YoutubeService, YoutubeOAuthService, YoutubeTokenService],
  exports: [YoutubeService, YoutubeOAuthService, YoutubeTokenService],
})
export class YoutubeModule {}
