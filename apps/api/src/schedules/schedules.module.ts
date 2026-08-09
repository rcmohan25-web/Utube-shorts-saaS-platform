import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { PublishProcessor } from '../queues/processors/publish.processor';
import { WebsocketsModule } from '../websockets/websockets.module';
import { YoutubeModule } from '../youtube/youtube.module';
import { QUEUE_NAMES } from '../queues/queue.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BillingModule } from '../billing/billing.module';
// PR 7 (§15 Notifications): SchedulesService fires SHORT_PUBLISHED and
// PIPELINE_FAILURE. NotificationsModule does not import SchedulesModule
// back, so this stays a one-way import — same shape as AnalyticsModule
// and BillingModule above.
import { NotificationsModule } from '../notifications/notifications.module';

// PublishProcessor is registered here (not in QueueModule) because it
// depends on SchedulesService and YoutubeTokenService — both scheduling
// domain objects. Registering it in QueueModule would create a circular
// import with SchedulesModule. The PUBLISH queue itself is still registered
// in QueueModule (which is Global), so @InjectQueue(PUBLISH) works fine
// from providers in this module.
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.PUBLISH }),
    WebsocketsModule,
    YoutubeModule,
    AnalyticsModule,
    BillingModule,
    NotificationsModule,
  ],
  providers: [SchedulesService, PublishProcessor],
  controllers: [SchedulesController],
  exports: [SchedulesService],
})
export class SchedulesModule {}
