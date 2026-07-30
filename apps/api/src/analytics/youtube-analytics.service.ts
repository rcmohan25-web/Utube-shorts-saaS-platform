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

// Wraps the YouTube Analytics API v2 `reports` endpoint (read-only). Requires
// the yt-analytics.readonly scope, already requested in
// youtube-oauth.service.ts §14.1 — no OAuth changes needed for this PR.
//
// One call = one video, one date range. See analytics.service.ts's daily
// cron for the cost/quota tradeoff of this (documented there, not solved
// here — batching via filters=video==id1,id2 is a follow-up).
@Injectable()
export class YoutubeAnalyticsService {
  private readonly logger = new Logger(YoutubeAnalyticsService.name);

  async fetchDailyMetrics(
    youtubeVideoId: string,
    fromDate: Date,
    toDate: Date,
    accessToken: string,
  ): Promise<DailyMetrics[]> {
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
      dimensions: 'day',
      filters: `video==${youtubeVideoId}`,
    });

    const res = await fetch(`https://youtubeanalytics.googleapis.com/v2/reports?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error({
        msg: 'youtube_analytics.fetch_failed',
        youtubeVideoId,
        status: res.status,
        body,
      });
      throw new ServiceUnavailableException('YouTube Analytics API request failed');
    }

    const json = await res.json();
    const rows: unknown[][] = json.rows ?? [];

    // Column order is fixed by the `metrics` string above:
    // day, views, watchMinutes, likes, comments, shares, subsGained.
    return rows.map((row) => ({
      date: row[0] as string,
      views: Number(row[1] ?? 0),
      watchTimeSeconds: Math.round(Number(row[2] ?? 0) * 60),
      likes: Number(row[3] ?? 0),
      comments: Number(row[4] ?? 0),
      shares: Number(row[5] ?? 0),
      subscribersGained: Number(row[6] ?? 0),
    }));
  }
}
