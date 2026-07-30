import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { subDays } from 'date-fns';
import { ShortStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { YoutubeTokenService } from '../youtube/youtube-token.service';
import { YoutubeAnalyticsService } from './youtube-analytics.service';
import { QUEUE_NAMES } from '../queues/queue.constants';

type AnalyticsSyncJobData = {
  shortId: string;
  organizationId: string;
  daysBack?: number;
};

// Lives in AnalyticsModule, not QueueModule — same precedent as
// PublishProcessor (see schedules.module.ts's comment): this processor
// depends on YoutubeTokenService, a domain service, so registering it in
// the global QueueModule would risk the same circular-import shape.
// The ANALYTICS_SYNC queue itself is still declared once in QueueModule
// (it's @Global()), so @InjectQueue(ANALYTICS_SYNC) resolves fine here.
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

  async process(job: Job<AnalyticsSyncJobData>): Promise<void> {
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
    // One Short's failure never blocks siblings: each is its own job.
    const rows = await this.ytAnalytics.fetchDailyMetrics(
      short.youtubeVideoId,
      fromDate,
      toDate,
      accessToken,
    );

    for (const row of rows) {
      // §20.6 idempotency table: @@unique([shortId, date]) makes this upsert
      // safe to re-run for the same day — exactly what the daily cron does.
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

    this.logger.log({ msg: 'analytics-sync.completed', shortId, organizationId, daysSynced: rows.length });
  }
}
