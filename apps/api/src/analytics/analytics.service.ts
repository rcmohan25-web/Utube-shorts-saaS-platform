import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { subDays } from 'date-fns';
import { ShortStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queues/queue.constants';

const ANALYTICS_RETENTION_DAYS = 90;

// PR 13 (§17 follow-up): cap on video IDs per batch job / per YouTube
// Analytics API call. Mirrors YoutubeAnalyticsService's own conservative
// cap (see that file's MAX_BATCH_VIDEO_IDS comment) — kept as a separate
// constant here rather than importing it, since this is a queueing
// decision (how big a job to build) and that one is an HTTP-call decision
// (how many filter values to send in one request); the two happen to
// agree today but aren't the same concern and shouldn't be coupled.
const ANALYTICS_BATCH_SIZE = 40;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.ANALYTICS_SYNC) private analyticsQueue: Queue,
  ) {}

  // Called by SchedulesService.markPublished() — §17.1: "24h after publish:
  // analytics-sync job queued for first day." jobId makes this idempotent:
  // a retried/duplicated markPublished() call is a safe no-op add().
  //
  // Deliberately stays per-Short (not batched) — see PR 13's README
  // section: publish events are scattered in time, so there's nothing
  // natural to batch them against, and this call volume was never the
  // cost driver (the daily cron re-syncing every published Short every
  // day was).
  async scheduleFirstSync(shortId: string, organizationId: string): Promise<void> {
    await this.analyticsQueue.add(
      'sync',
      { shortId, organizationId, daysBack: 1 },
      {
        jobId: `analytics-sync-first_${shortId}`,
        delay: 24 * 60 * 60 * 1000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  }

  // §17.1: "Daily cron (3am UTC): sync all published Shorts for last 90 days."
  //
  // PR 13 (§17 follow-up): previously fanned out one job — and one
  // YouTube Analytics API call — per Short. Now groups Shorts by channel
  // (the API call is authenticated as one channel owner's token, so only
  // same-channel Shorts can share a request) and chunks each channel's
  // video IDs into ANALYTICS_BATCH_SIZE-sized batches, so a channel with
  // e.g. 45 published Shorts costs 2 API calls today instead of 45.
  @Cron('0 3 * * *')
  async dailySyncAllPublished(): Promise<void> {
    const shorts = await this.prisma.client.short.findMany({
      where: {
        status: ShortStatus.PUBLISHED,
        updatedAt: { gte: subDays(new Date(), ANALYTICS_RETENTION_DAYS) },
      },
      select: {
        id: true,
        organizationId: true,
        channelId: true,
        youtubeVideoId: true,
        channel: { select: { userId: true } },
      },
    });

    const byChannel = new Map<
      string,
      { organizationId: string; userId: string; items: { shortId: string; youtubeVideoId: string }[] }
    >();

    for (const s of shorts) {
      if (!s.youtubeVideoId) continue; // shouldn't happen for PUBLISHED, but guard rather than crash the cron
      const group = byChannel.get(s.channelId) ?? {
        organizationId: s.organizationId,
        userId: s.channel.userId,
        items: [] as { shortId: string; youtubeVideoId: string }[],
      };
      group.items.push({ shortId: s.id, youtubeVideoId: s.youtubeVideoId });
      byChannel.set(s.channelId, group);
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    let batchCount = 0;

    for (const [channelId, group] of byChannel) {
      const batches = chunk(group.items, ANALYTICS_BATCH_SIZE);
      for (const [index, items] of batches.entries()) {
        await this.analyticsQueue.add(
          'batch-sync',
          { organizationId: group.organizationId, channelId, userId: group.userId, items, daysBack: 3 },
          {
            // Date + channel + chunk-index-scoped jobId: re-running the
            // cron the same day is a no-op; a channel needing multiple
            // batches gets one distinct job per chunk; tomorrow's run
            // gets fresh jobIds and actually re-syncs.
            jobId: `analytics-sync-daily-batch_${channelId}_${index}_${todayKey}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 60_000 },
          },
        );
        batchCount++;
      }
    }

    this.logger.log({
      msg: 'analytics.daily_sync_enqueued',
      shortCount: shorts.length,
      channelCount: byChannel.size,
      batchCount,
    });
  }

  // GET /analytics/overview — §17.2 metric definitions, org-scoped.
  async overview(organizationId: string, from: Date, to: Date) {
    const rows = await this.prisma.client.analyticsDaily.findMany({
      where: { organizationId, date: { gte: from, lte: to } },
    });

    const totals = rows.reduce(
      (acc, r) => ({
        totalViews: acc.totalViews + r.views,
        totalWatchTimeSeconds: acc.totalWatchTimeSeconds + r.watchTimeSeconds,
        totalLikes: acc.totalLikes + r.likes,
        totalComments: acc.totalComments + r.comments,
        totalShares: acc.totalShares + r.shares,
        subscribersGained: acc.subscribersGained + r.subscribersGained,
      }),
      {
        totalViews: 0,
        totalWatchTimeSeconds: 0,
        totalLikes: 0,
        totalComments: 0,
        totalShares: 0,
        subscribersGained: 0,
      },
    );

    // Avg View Duration = SUM(watchTime) / SUM(views), per §17.2.
    const avgViewDurationSeconds = totals.totalViews > 0
      ? totals.totalWatchTimeSeconds / totals.totalViews
      : 0;

    // Best Short = MAX(views) in range, per §17.2.
    const byShort = new Map<string, number>();
    for (const r of rows) byShort.set(r.shortId, (byShort.get(r.shortId) ?? 0) + r.views);
    let bestShortId: string | null = null;
    let bestViews = -1;
    for (const [shortId, views] of byShort) {
      if (views > bestViews) {
        bestViews = views;
        bestShortId = shortId;
      }
    }

    // Publish Rate = COUNT(published Shorts) / days in period, per §17.2.
    // The period is inclusive of both endpoints, so a one-day window from
    // 2026-07-28 to 2026-07-29 should count as 2 days.
    const daysInPeriod = Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1);
    const publishedCount = await this.prisma.client.short.count({
      where: { organizationId, status: ShortStatus.PUBLISHED, updatedAt: { gte: from, lte: to } },
    });

    // 7/30/90-day time series for the dashboard chart (§11.1, §11.5).
    const seriesMap = new Map<string, { views: number }>();
    for (const r of rows) {
      const key = r.date.toISOString().slice(0, 10);
      const entry = seriesMap.get(key) ?? { views: 0 };
      entry.views += r.views;
      seriesMap.set(key, entry);
    }

    return {
      ...totals,
      avgViewDurationSeconds,
      bestShortId,
      publishRate: publishedCount / daysInPeriod,
      series: Array.from(seriesMap.entries())
        .map(([date, v]) => ({ date, views: v.views }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // GET /analytics/shorts/:id — per-Short daily time-series, §17.1/§11.5.
  async shortSeries(shortId: string, organizationId: string, from: Date, to: Date) {
    const short = await this.prisma.client.short.findFirst({
      where: { id: shortId, organizationId },
      select: { id: true, title: true, youtubeVideoId: true, status: true },
    });
    if (!short) return null;

    const series = await this.prisma.client.analyticsDaily.findMany({
      where: { shortId, organizationId, date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
    });

    return { short, series };
  }
}
