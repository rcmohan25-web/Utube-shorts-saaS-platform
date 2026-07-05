import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { VideoGateway } from './video.gateway';

// Own JwtModule registration (same JWT_SECRET as AuthModule) so the gateway
// can verify the handshake token without importing AuthModule — same
// "shared secret, independent JwtService instance" pattern as YoutubeModule.
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
  providers: [VideoGateway],
  exports: [VideoGateway],
})
export class WebsocketsModule {}
