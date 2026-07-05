import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VideoDownloadProcessor } from './processors/video-download.processor';
import { TranscriptionProcessor } from './processors/transcription.processor';
import { ClipDetectionProcessor } from './processors/clip-detection.processor';
import { RenderProcessor } from './processors/render.processor';

// Global so any feature module can @InjectQueue() without re-importing.
// Queue names + concurrency/retry policy match §7.1 of the spec.
export const QUEUE_NAMES = {
  VIDEO_DOWNLOAD: 'video-download',
  TRANSCRIPTION: 'transcription',
  CLIP_DETECTION: 'clip-detection',
  RENDER: 'render',
  PUBLISH: 'publish',
  ANALYTICS_SYNC: 'analytics-sync',
  NOTIFICATION: 'notification',
} as const;

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue(
      { name: QUEUE_NAMES.VIDEO_DOWNLOAD },
      { name: QUEUE_NAMES.TRANSCRIPTION },
      { name: QUEUE_NAMES.CLIP_DETECTION },
      { name: QUEUE_NAMES.RENDER },
      { name: QUEUE_NAMES.PUBLISH },
      { name: QUEUE_NAMES.ANALYTICS_SYNC },
      { name: QUEUE_NAMES.NOTIFICATION },
    ),
  ],
  // Workers that consume jobs and dispatch them to the Python services over
  // HTTP (ADR-002). publish processor lands in the next PR alongside
  // publish-worker.
  providers: [VideoDownloadProcessor, TranscriptionProcessor, ClipDetectionProcessor, RenderProcessor],
  exports: [BullModule],
})
export class QueueModule {}
