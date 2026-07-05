import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUE_NAMES } from '../queue.module';

type RenderJobData = { shortId: string; clipId: string; organizationId: string };

// Unlike the other dispatch processors, this one does real DB lookups before
// calling out: the BullMQ payload is deliberately minimal (§7.1 lists
// roughly { clipId, videoS3Key, orgId, brandConfig }), so we fetch the
// Clip/Video/Organization fresh at dispatch time rather than bake
// potentially-stale branding into a job that might sit queued for a while.
@Processor(QUEUE_NAMES.RENDER)
export class RenderProcessor extends WorkerHost {
  private readonly logger = new Logger(RenderProcessor.name);

  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job<RenderJobData>): Promise<void> {
    const { shortId, clipId, organizationId } = job.data;

    const clip = await this.prisma.client.clip.findFirst({
      where: { id: clipId, organizationId },
      include: { video: true },
    });
    if (!clip) throw new Error(`Clip ${clipId} not found for render job ${shortId}`);

    const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });

    const workerUrl = process.env.RENDER_WORKER_URL ?? 'http://localhost:8003';
    const res = await fetch(`${workerUrl}/jobs/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shortId,
        clipId: clip.id,
        organizationId,
        channelId: clip.video.channelId,
        videoS3Key: clip.video.rawVideoS3Key,
        transcriptS3Key: clip.video.transcriptS3Key,
        startSeconds: clip.startSeconds,
        endSeconds: clip.endSeconds,
        title: clip.suggestedTitle ?? clip.video.title,
        hashtags: clip.suggestedHashtags,
        brandLogoS3Key: org?.logoS3Key ?? null,
        brandColor: org?.brandColor ?? null,
      }),
    });

    if (!res.ok) {
      throw new Error(`render-worker rejected render job ${shortId}: ${res.status}`);
    }

    this.logger.log(`Dispatched render job for short ${shortId} (clip ${clipId}) to render-worker`);
  }
}
