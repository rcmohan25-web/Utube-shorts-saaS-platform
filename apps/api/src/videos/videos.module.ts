import { Module } from '@nestjs/common';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { YoutubeModule } from '../youtube/youtube.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { ClipsModule } from '../clips/clips.module';

@Module({
  imports: [YoutubeModule, WebsocketsModule, ClipsModule],
  providers: [VideosService],
  controllers: [VideosController],
  exports: [VideosService],
})
export class VideosModule {}
