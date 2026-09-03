import { Module } from '@nestjs/common';
import { PublicApiController } from './public-api.controller';
import { VideosModule } from '../videos/videos.module';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [VideosModule, ApiKeysModule],
  controllers: [PublicApiController],
})
export class PublicApiModule {}
