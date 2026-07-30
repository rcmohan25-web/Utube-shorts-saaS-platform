import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VideoDownloadProcessor } from './processors/video-download.processor';
import { TranscriptionProcessor } from './processors/transcription.processor';
import { ClipDetectionProcessor } from './processors/clip-detection.processor';
import { RenderProcessor } from './processors/render.processor';

// PublishProcessor is intentionally NOT here — see schedules/schedules.module.ts
// for the explanation. Every other processor is a stateless HTTP dispatcher
// (POST to Python worker, return). PublishProcessor is stateful (needs
// YoutubeTokenService + SchedulesService) and lives in its own domain module.

export const QUEUE_NAMES = {
  VIDEO_DOWNLOAD: 'video-download',
  TRANSCRIPTION: 'transcription',
  CLIP_DETECTION: 'clip-detection',
  RENDER: 'render',
  PUBLISH: 'publish',
  ANALYTICS_SYNC: 'analytics-sync',
  NOTIFICATION: 'notification',
} as const;

const getRedisConnection = () => {
  const rawHost = (process.env.REDIS_HOST ?? '127.0.0.1').trim();
  const port = Number(process.env.REDIS_PORT ?? 6379);

  if (rawHost.startsWith('redis://') || rawHost.startsWith('rediss://')) {
    return { url: rawHost, port };
  }

  return {
    host: rawHost === 'localhost' ? '127.0.0.1' : rawHost,
    port,
  };
};

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: getRedisConnection(),
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.VIDEO_DOWNLOAD },
      { name: QUEUE_NAMES.TRANSCRIPTION },
      { name: QUEUE_NAMES.CLIP_DETECTION },
      { name: QUEUE_NAMES.RENDER },
      { name: QUEUE_NAMES.PUBLISH },       // registered here so @InjectQueue(PUBLISH)
      { name: QUEUE_NAMES.ANALYTICS_SYNC }, // works in SchedulesModule
      { name: QUEUE_NAMES.NOTIFICATION },
    ),
  ],
  providers: [
    VideoDownloadProcessor,
    TranscriptionProcessor,
    ClipDetectionProcessor,
    RenderProcessor,
    // PublishProcessor lives in SchedulesModule — not here
    // Ensure a QueueScheduler runs for the PUBLISH queue so delayed jobs
    // are moved to the wait queue when their delay expires.
    {
      provide: 'PUBLISH_QUEUE_SCHEDULER',
      useFactory: () => {
        // Import dynamically to avoid TypeScript build issues when the
        // installed bullmq version's typing doesn't expose QueueScheduler.
        // Use CommonJS require here so the code compiles reliably.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const BullMQ = require('bullmq');
        const Scheduler = BullMQ.QueueScheduler ?? BullMQ.JobScheduler;
        if (!Scheduler) {
          throw new Error('BullMQ scheduler class not found: expected QueueScheduler or JobScheduler');
        }

        return new Scheduler(QUEUE_NAMES.PUBLISH, {
          connection: getRedisConnection(),
        });
      },
    },
  ],
  exports: [BullModule],
})
export class QueueModule {}
