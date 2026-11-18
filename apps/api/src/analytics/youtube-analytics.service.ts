import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { format } from 'date-fns';

export type DailyMetrics = {
  date: string; // YYYY-MM-DD
  views: number;
  watchTimeSeconds: number;
  likes: number;
  comments: number;
  shares: number;
  subscribersGained: number;
};

// PR 13 (§17 follow-up): max video IDs per `filters=video==...` value.
// YouTube Analytics doesn't publish a hard cap on filter-value count, but
// URL length and practical response-size limits make a conservative cap
// the safe choice. 40 video IDs (11 chars each) keeps the filters value
// comfortably under 1KB — nowhere near typical URL length limits — while
// still collapsing the common case (a channel publishing a few dozen
// Shorts/day) into a single call. AnalyticsService.ANALYTICS_BATCH_SIZE is
// the source of truth for how big a batch job we actually build; this
// constant exists here purely as documentation of what this method itself
// assumes is safe to send in one request.
export const MAX_BATCH_VIDEO_IDS = 40;

// Wraps the YouTube Analytics API v2 `reports` endpoint (read-only). Requires
// the yt-analytics.readonly scope, already requested in
// youtube-oauth.service.ts §14.1 — no OAuth changes needed for this PR.
@Injectable()
export class YoutubeAnalyticsService {
  private readonly logger = new Logger(YoutubeAnalyticsService.name);

  // One call = one video, one date range. Kept as the simplest building
  // block — trivial to unit test in isolation — and now implemented as a
  // thin wrapper around fetchDailyMetricsBatch() so there's exactly one
  // code path that talks to the YouTube Analytics API.
  async fetchDailyMetrics(
    youtubeVideoId: string,
    fromDate: Date,
    toDate: Date,
    accessToken: string,
  ): Promise<DailyMetrics[]> {
    const byVideo = await this.fetchDailyMetricsBatch([youtubeVideoId], fromDate, toDate, accessToken);
    return byVideo.get(youtubeVideoId) ?? [];
  }

  // PR 13 (§17 follow-up): one call = up to MAX_BATCH_VIDEO_IDS videos,
  // one date range. Adding `video` as a second dimension alongside `day`
  // is what lets a single response carry every video's daily rows —
  // AnalyticsSyncProcessor.processBatch() is the caller, via
  // AnalyticsService.dailySyncAllPublished()'s per-channel batches.
  //
  // Column order in each response row follows the order requested:
  // dimensions first ("day,video"), then metrics in the order listed in
  // the `metrics` param below. This is a YouTube Analytics API contract,
  // not something we infer from the response shape.
  async fetchDailyMetricsBatch(
    youtubeVideoIds: string[],
    fromDate: Date,
    toDate: Date,
    accessToken: string,
  ): Promise<Map<string, DailyMetrics[]>> {
    if (youtubeVideoIds.length === 0) return new Map();

    const metrics = [
      'views',
      'estimatedMinutesWatched',
      'likes',
      'comments',
      'shares',
      'subscribersGained',
    ].join(',');

    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: format(fromDate, 'yyyy-MM-dd'),
      endDate: format(toDate, 'yyyy-MM-dd'),
      metrics,
      dimensions: 'day,video',
      filters: `video==${youtubeVideoIds.join(',')}`,
    });

    const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error({
        msg: 'youtube_analytics.batch_fetch_failed',
        videoCount: youtubeVideoIds.length,
        status: res.status,
        body,
      });
      throw new ServiceUnavailableException('YouTube Analytics API batch request failed');
    }

    const json = await res.json();
    const rows: unknown[][] = json.rows ?? [];

    // dimensions=day,video -> row[0]=day, row[1]=video, then the metrics
    // in the order requested above.
    const byVideo = new Map<string, DailyMetrics[]>();
    for (const row of rows) {
      const videoId = row[1] as string;
      const entry: DailyMetrics = {
        date: row[0] as string,
        views: Number(row[2] ?? 0),
        watchTimeSeconds: Math.round(Number(row[3] ?? 0) * 60),
        likes: Number(row[4] ?? 0),
        comments: Number(row[5] ?? 0),
        shares: Number(row[6] ?? 0),
        subscribersGained: Number(row[7] ?? 0),
      };
      const existing = byVideo.get(videoId);
      if (existing) existing.push(entry);
      else byVideo.set(videoId, [entry]);
    }

    return byVideo;
  }
}
