import { Module } from '@nestjs/common';
import { VideosService } from './videos.service';
import { VideosController } from './videos.controller';
import { YoutubeModule } from '../youtube/youtube.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { ClipsModule } from '../clips/clips.module';
// PR 7 (§15 Notifications): VideosService.applyStatusCallback() fires
// PIPELINE_FAILURE on a FAILED transition. One-way import, no cycle.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [YoutubeModule, WebsocketsModule, ClipsModule, NotificationsModule],
  providers: [VideosService],
  controllers: [VideosController],
  exports: [VideosService],
})
export class VideosModule {}
