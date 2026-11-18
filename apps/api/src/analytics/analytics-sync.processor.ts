import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { subDays } from 'date-fns';
import { ShortStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { YoutubeTokenService } from '../youtube/youtube-token.service';
import { YoutubeAnalyticsService, type DailyMetrics } from './youtube-analytics.service';
import { QUEUE_NAMES } from '../queues/queue.constants';

type AnalyticsSyncJobData = {
  shortId: string;
  organizationId: string;
  daysBack?: number;
};

// PR 13 (§17 follow-up): payload for the batched daily-cron path —
// multiple Shorts on the same channel, synced with one YouTube Analytics
// API call instead of one call each. Built by
// AnalyticsService.dailySyncAllPublished().
type BatchAnalyticsSyncJobData = {
  organizationId: string;
  channelId: string;
  userId: string; // channel owner — token lookup key
  items: { shortId: string; youtubeVideoId: string }[];
  daysBack?: number;
};

// Lives in AnalyticsModule, not QueueModule — same precedent as
// PublishProcessor (see schedules.module.ts's comment): this processor
// depends on YoutubeTokenService, a domain service, so registering it in
// the global QueueModule would risk the same circular-import shape.
// The ANALYTICS_SYNC queue itself is still declared once in QueueModule
// (it's @Global()), so @InjectQueue(ANALYTICS_SYNC) resolves fine here.
//
// PR 13: this processor now handles two job shapes on the same queue —
// 'sync' (single Short, used by scheduleFirstSync's 24h-after-publish
// job) and 'batch-sync' (multiple same-channel Shorts, used by the daily
// cron). BullMQ dispatches every job on a queue to the same process()
// method regardless of job name, so we branch on job.name rather than
// registering two processors on the same queue.
@Processor(QUEUE_NAMES.ANALYTICS_SYNC)
export class AnalyticsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsSyncProcessor.name);

  constructor(
    private prisma: PrismaService,
    private tokenService: YoutubeTokenService,
    private ytAnalytics: YoutubeAnalyticsService,
  ) {
    super();
  }

  async process(job: Job<AnalyticsSyncJobData | BatchAnalyticsSyncJobData>): Promise<void> {
    if (job.name === 'batch-sync') {
      return this.processBatch(job as Job<BatchAnalyticsSyncJobData>);
    }
    return this.processSingle(job as Job<AnalyticsSyncJobData>);
  }

  // Unchanged behavior from pre-PR-13 — still used by scheduleFirstSync().
  // One Short's failure never blocks siblings: each is its own job.
  private async processSingle(job: Job<AnalyticsSyncJobData>): Promise<void> {
    const { shortId, organizationId, daysBack = 3 } = job.data;

    const short = await this.prisma.client.short.findFirst({
      where: { id: shortId, organizationId },
      include: { channel: { include: { user: true } } },
    });

    // The Short may have been re-rendered, rejected, or unpublished since
    // this job was queued (first-sync jobs sit delayed for 24h) — not an
    // error, just nothing to sync.
    if (!short || short.status !== ShortStatus.PUBLISHED || !short.youtubeVideoId) {
      this.logger.log({
        msg: 'analytics-sync.skipped_not_published',
        shortId,
        status: short?.status ?? 'NOT_FOUND',
      });
      return;
    }

    const accessToken = await this.tokenService.getValidAccessToken(short.channel.userId);
    const toDate = new Date();
    const fromDate = subDays(toDate, daysBack);

    // Let this throw on failure — BullMQ's per-job retry policy (set at
    // add()-time in analytics.service.ts) handles transient API errors.
    const rows = await this.ytAnalytics.fetchDailyMetrics(short.youtubeVideoId, fromDate, toDate, accessToken);

    for (const row of rows) {
      await this.upsertDaily(organizationId, shortId, row);
    }

    this.logger.log({ msg: 'analytics-sync.completed', shortId, organizationId, daysSynced: rows.length });
  }

  // PR 13: fires once per channel-batch from dailySyncAllPublished(). One
  // YouTube Analytics API call covers every Short in `items` instead of
  // one call per Short — this is the actual cost/quota fix this PR ships.
  private async processBatch(job: Job<BatchAnalyticsSyncJobData>): Promise<void> {
    const { organizationId, channelId, userId, items, daysBack = 3 } = job.data;
    if (items.length === 0) return;

    // Re-check PUBLISHED status at fire time — this batch was built when
    // the cron ran, but a Short may have been re-rendered, rejected, or
    // unpublished in the time it sat queued. Same "nothing to sync isn't
    // an error" spirit as processSingle()'s skip branch, applied per-item
    // instead of aborting the whole batch.
    const stillPublished = await this.prisma.client.short.findMany({
      where: { id: { in: items.map((i) => i.shortId) }, organizationId, status: ShortStatus.PUBLISHED },
      select: { id: true },
    });
    const publishedIds = new Set(stillPublished.map((s) => s.id));
    const toSync = items.filter((i) => publishedIds.has(i.shortId));

    if (toSync.length === 0) {
      this.logger.log({ msg: 'analytics-sync.batch_skipped_none_published', channelId, organizationId });
      return;
    }

    const accessToken = await this.tokenService.getValidAccessToken(userId);
    const toDate = new Date();
    const fromDate = subDays(toDate, daysBack);

    // The one API call this whole batch exists to collapse into.
    const byVideo = await this.ytAnalytics.fetchDailyMetricsBatch(
      toSync.map((i) => i.youtubeVideoId),
      fromDate,
      toDate,
      accessToken,
    );

    let daysSynced = 0;
    for (const { shortId, youtubeVideoId } of toSync) {
      const rows: DailyMetrics[] = byVideo.get(youtubeVideoId) ?? [];
      for (const row of rows) {
        await this.upsertDaily(organizationId, shortId, row);
        daysSynced++;
      }
    }

    this.logger.log({
      msg: 'analytics-sync.batch_completed',
      channelId,
      organizationId,
      videoCount: toSync.length,
      daysSynced,
      apiCallsUsed: 1,
    });
  }

  // §20.6 idempotency table: @@unique([shortId, date]) makes this upsert
  // safe to re-run for the same day. Shared by both the single and batch
  // paths so the write shape can never drift between them.
  private async upsertDaily(organizationId: string, shortId: string, row: DailyMetrics) {
    await this.prisma.client.analyticsDaily.upsert({
      where: { shortId_date: { shortId, date: new Date(row.date) } },
      create: {
        organizationId,
        shortId,
        date: new Date(row.date),
        views: row.views,
        watchTimeSeconds: row.watchTimeSeconds,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        subscribersGained: row.subscribersGained,
      },
      update: {
        views: row.views,
        watchTimeSeconds: row.watchTimeSeconds,
        likes: row.likes,
        comments: row.comments,
        shares: row.shares,
        subscribersGained: row.subscribersGained,
      },
    });
  }
}
