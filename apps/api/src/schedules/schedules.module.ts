import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';
import { PublishProcessor } from '../queues/processors/publish.processor';
import { WebsocketsModule } from '../websockets/websockets.module';
import { YoutubeModule } from '../youtube/youtube.module';
import { QUEUE_NAMES } from '../queues/queue.module';

// PublishProcessor is registered here (not in QueueModule) because it
// depends on SchedulesService and YoutubeTokenService — both scheduling
// domain objects. Registering it in QueueModule would create a circular
// import with SchedulesModule. The PUBLISH queue itself is still registered
// in QueueModule (which is Global), so @InjectQueue(PUBLISH) works fine
// from providers in this module.
// NOTE: We must import BullModule.registerQueue here so the @Processor
// decorator on PublishProcessor can properly initialize the worker.
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.PUBLISH }),
    WebsocketsModule,
    YoutubeModule,
  ],
  providers: [SchedulesService, PublishProcessor],
  controllers: [SchedulesController],
  exports: [SchedulesService],
})
export class SchedulesModule {}
