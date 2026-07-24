import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE_NAMES } from '../queue.constants';

type TranscribeJobData = { videoId: string; audioS3Key: string; organizationId: string };

// Same dispatcher pattern as VideoDownloadProcessor — see that file's
// comment for why this only confirms *acceptance*, not completion.
@Processor(QUEUE_NAMES.TRANSCRIPTION)
export class TranscriptionProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscriptionProcessor.name);

  async process(job: Job<TranscribeJobData>): Promise<void> {
    const workerUrl = process.env.TRANSCRIPTION_WORKER_URL ?? 'http://localhost:8001';

    const res = await fetch(`${workerUrl}/jobs/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job.data),
    });

    if (!res.ok) {
      throw new Error(`transcription-worker rejected job ${job.data.videoId}: ${res.status}`);
    }

    this.logger.log(`Dispatched transcription job ${job.data.videoId} to transcription-worker`);
  }
}
