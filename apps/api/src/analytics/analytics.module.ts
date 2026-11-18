import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsSyncProcessor } from './analytics-sync.processor';
import { YoutubeAnalyticsService } from './youtube-analytics.service';
import { YoutubeModule } from '../youtube/youtube.module';
import { QUEUE_NAMES } from '../queues/queue.constants';

// PR 13 note: no changes here. AnalyticsSyncProcessor and
// YoutubeAnalyticsService keep the exact constructor signatures Nest
// already wires up — this module's job is unaffected by adding a second
// job shape ('batch-sync') on the same already-registered queue.
//
// Mirrors SchedulesModule's shape (see that file's comment / ADR-002):
// the ANALYTICS_SYNC queue is already registered once in the global
// QueueModule, but its stateful processor — needs YoutubeTokenService —
// lives here instead, to avoid the same circular-import risk.
//
// AnalyticsModule imports YoutubeModule (for token refresh) but NOT
// SchedulesModule, so SchedulesModule -> AnalyticsModule is a one-way
// import with no cycle.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ANALYTICS_SYNC }), YoutubeModule],
  providers: [AnalyticsService, AnalyticsSyncProcessor, YoutubeAnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
