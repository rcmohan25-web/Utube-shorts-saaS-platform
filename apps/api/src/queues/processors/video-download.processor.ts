import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.module';

type DownloadJobData = { videoId: string; youtubeUrl: string; organizationId: string };

// Per ADR-002: NestJS dispatches, Python processes. This Worker's only job
// is to hand the payload to clip-worker over HTTP and mark the BullMQ job
// done once clip-worker has *accepted* it — not once the download itself
// finishes (that can take minutes; clip-worker reports real progress back
// via PATCH /videos/:id/status, watched over by the stuck-pipeline cron in
// §7.3, not by BullMQ's own retry count).
//
// This replaces the ad-hoc Redis-list polling that used to live in
// clip-worker/main.py, which never spoke BullMQ's actual wire protocol.
@Processor(QUEUE_NAMES.VIDEO_DOWNLOAD)
export class VideoDownloadProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoDownloadProcessor.name);

  async process(job: Job<DownloadJobData>): Promise<void> {
    const workerUrl = process.env.CLIP_WORKER_URL ?? 'http://localhost:8002';

    const res = await fetch(`${workerUrl}/jobs/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job.data),
    });

    if (!res.ok) {
      // BullMQ retries this (3x exponential backoff, per §7.1) — appropriate
      // here since failure means clip-worker never even accepted the job.
      throw new Error(`clip-worker rejected download job ${job.data.videoId}: ${res.status}`);
    }

    this.logger.log(`Dispatched download job ${job.data.videoId} to clip-worker`);
  }
}
