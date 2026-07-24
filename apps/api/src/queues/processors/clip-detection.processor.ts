import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';

type DetectClipsJobData = {
  videoId: string;
  organizationId: string;
  rawVideoS3Key: string;
  audioS3Key: string;
  transcriptS3Key: string;
  videoTitle: string;
};

@Processor(QUEUE_NAMES.CLIP_DETECTION)
export class ClipDetectionProcessor extends WorkerHost {
  private readonly logger = new Logger(ClipDetectionProcessor.name);

  async process(job: Job<DetectClipsJobData>): Promise<void> {
    const workerUrl = process.env.CLIP_WORKER_URL ?? 'http://localhost:8002';

    const res = await fetch(`${workerUrl}/jobs/detect-clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job.data),
    });

    if (!res.ok) {
      throw new Error(`clip-worker rejected detect-clips job ${job.data.videoId}: ${res.status}`);
    }

    this.logger.log(`Dispatched clip-detection job ${job.data.videoId} to clip-worker`);
  }
}
