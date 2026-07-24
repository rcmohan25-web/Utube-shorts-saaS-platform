import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { YoutubeTokenService } from '../../youtube/youtube-token.service';
import { QUEUE_NAMES } from '../../queues/queue.module';
import { SchedulesService } from '../../schedules/schedules.service';

type PublishJobData = { scheduleId: string; organizationId: string };

// NOTE ON PLACEMENT: This processor lives in SchedulesModule (not QueueModule)
// because it depends on SchedulesService and YoutubeTokenService — both are
// scheduling domain objects. Putting it in QueueModule would create a circular
// import: QueueModule → SchedulesService → SchedulesModule → @InjectQueue(PUBLISH)
// → QueueModule. NestJS can't resolve that without forwardRef() hacks.
// The other four processors are stateless HTTP dispatchers and belong in
// QueueModule. This one is stateful and belongs here.
//
// NOTE ON RESPONSIBILITY SPLIT: This processor's only job is to get a fresh
// token and hand the work to publish-worker. The actual YouTube upload happens
// asynchronously in Python. publish-worker calls back when done via:
//   PATCH /schedules/:id/complete   → markPublished()
//   PATCH /schedules/:id/failed     → markFailed()
//   PATCH /schedules/:id/quota-exceeded → postponeForQuota()
@Processor(QUEUE_NAMES.PUBLISH)
export class PublishProcessor extends WorkerHost {
  private readonly logger = new Logger(PublishProcessor.name);

  constructor(
    private prisma: PrismaService,
    private youtubeTokenService: YoutubeTokenService,
    private schedulesService: SchedulesService,
  ) {
    super();
  }

  async process(job: Job<PublishJobData>): Promise<void> {
    const { scheduleId, organizationId } = job.data;
    const t0 = Date.now();

    // ── Load the full chain needed for dispatch ─────────────────────────────
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id: scheduleId, organizationId },
      include: {
        short: true,
        channel: { include: { user: true } },
      },
    });

    if (!schedule) {
      // Don't throw — retrying a deleted schedule won't help.
      this.logger.warn({ msg: 'publish.schedule_not_found', scheduleId, organizationId });
      return;
    }

    // ── Guards ──────────────────────────────────────────────────────────────

    // Guard 1: non-PENDING schedules (cancelled while in the delay queue)
    if (schedule.status !== 'PENDING') {
      this.logger.log({
        msg: 'publish.skipped.non_pending',
        scheduleId,
        status: schedule.status,
      });
      return;
    }

    // Guard 2: Guarantee G2 — idempotency. If Short already has a YouTube id,
    // a previous attempt uploaded successfully but the callback to NestJS
    // failed. Finalize without re-uploading.
    if (schedule.short.youtubeVideoId) {
      this.logger.log({
        msg: 'publish.idempotent.already_uploaded',
        scheduleId,
        youtubeVideoId: schedule.short.youtubeVideoId,
      });
      await this.schedulesService.markPublished(
        scheduleId,
        organizationId,
        schedule.short.youtubeVideoId,
      );
      return;
    }

    if (!schedule.short.renderS3Key) {
      // This should never happen (SchedulesService.create validates it), but
      // if it does, fail fast rather than calling publish-worker with no file.
      throw new Error(`Short ${schedule.shortId} has no render file — cannot publish`);
    }

    // ── Token refresh — critical path, always at dispatch time ──────────────
    // Never cache the token from job creation time — it could be 60+ minutes
    // stale by the time this job fires (delayed jobs, retry backoff).
    const accessToken = await this.youtubeTokenService.getValidAccessToken(
      schedule.channel.userId,
    );

    // ── Dispatch to publish-worker over HTTP (ADR-002) ──────────────────────
    const workerUrl = process.env.PUBLISH_WORKER_URL ?? 'http://localhost:8004';

    const res = await fetch(`${workerUrl}/jobs/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduleId,
        organizationId,
        shortId: schedule.shortId,
        channelId: schedule.channelId,
        renderS3Key: schedule.short.renderS3Key,
        thumbnailS3Key: schedule.short.thumbnailS3Key ?? null,
        title: schedule.short.title,
        description: schedule.short.description ?? '',
        tags: schedule.short.tags ?? [],
        scheduledAt: schedule.scheduledAt.toISOString(),
        // Decrypted, short-lived OAuth access token. Transport is internal
        // service-to-service over the Docker/K8s network — not public internet.
        // Storing it in the BullMQ payload would be wrong (stale + stored in
        // Redis). Passing it here guarantees it's fresh at the moment of use.
        accessToken,
      }),
    });

    if (!res.ok) {
      // Non-202 means publish-worker rejected the job before even starting the
      // upload. BullMQ will retry (5x exponential backoff per §7.1).
      throw new Error(
        `publish-worker rejected schedule ${scheduleId}: HTTP ${res.status}`,
      );
    }

    this.logger.log({
      msg: 'publish.dispatched_to_worker',
      scheduleId,
      shortId: schedule.shortId,
      channelId: schedule.channelId,
      organizationId,
      scheduledAt: schedule.scheduledAt.toISOString(),
      dispatchMs: Date.now() - t0,
    });

    // BullMQ job is now COMPLETE. The actual YouTube upload continues
    // asynchronously inside publish-worker. Results come back via the
    // three internal callback endpoints on SchedulesController.
  }
}
