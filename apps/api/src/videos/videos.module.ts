import { Module } from '@nestjs/common';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { YoutubeService } from '../youtube/youtube.service';

@Module({
  providers: [VideosService, YoutubeService],
  controllers: [VideosController],
  exports: [VideosService],
})
export class VideosModule {}
