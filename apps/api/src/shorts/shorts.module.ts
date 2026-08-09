import { Module } from '@nestjs/common';
import { ShortsService } from './shorts.service';
import { ShortsController } from './shorts.controller';
import { WebsocketsModule } from '../websockets/websockets.module';
// PR 7 (§15 Notifications): ShortsService.createFromWorker() fires
// SHORTS_READY. NotificationsModule does not import ShortsModule, so this
// stays a one-way import — no cycle, same shape as AnalyticsModule.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [WebsocketsModule, NotificationsModule],
  providers: [ShortsService],
  controllers: [ShortsController],
  exports: [ShortsService],
})
export class ShortsModule {}
