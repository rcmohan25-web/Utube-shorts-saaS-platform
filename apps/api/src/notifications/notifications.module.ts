import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationBatchProcessor } from './notification-batch.processor';
import { EmailService } from './email.service';
import { SlackService } from './slack.service';
import { WebsocketsModule } from '../websockets/websockets.module';
import { QUEUE_NAMES } from '../queues/queue.constants';

// Mirrors AnalyticsModule/SchedulesModule's shape: registers the already-
// global NOTIFICATION queue again locally so its processor (which needs
// NotificationsService) can live here without risking a circular import
// back into whichever domain module triggered the notification.
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATION }), WebsocketsModule],
  providers: [NotificationsService, EmailService, SlackService, NotificationBatchProcessor],
  controllers: [NotificationsController],
  exports: [NotificationsService],
})
export class NotificationsModule {}
