import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';

export type YoutubeVideoMeta = {
  title: string;
  durationSeconds: number;
  thumbnailUrl: string;
};

// Parses a YouTube URL (watch, youtu.be, shorts) into a raw video ID.
export function extractYoutubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const match = url.match(re);
    if (match) return match[1];
  }
  return null;
}

function isoDurationToSeconds(iso: string): number {
  // PT#H#M#S -> seconds
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, h, m, s] = match;
  return (Number(h ?? 0) * 3600) + (Number(m ?? 0) * 60) + Number(s ?? 0);
}

@Injectable()
export class YoutubeService {
  // Calls YouTube Data API v3 directly (no googleapis SDK dependency yet —
  // swap for the official client once OAuth/upload is wired in Sprint "YouTube Integration").
  async getVideoMeta(youtubeId: string): Promise<YoutubeVideoMeta> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      // Local dev without a key configured yet: don't block the Day-4 milestone.
      return {
        title: `Untitled video (${youtubeId})`,
        durationSeconds: 0,
        thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      };
    }

    const url = `https://www.googleapis.com/youtube/v3/videos?id=${youtubeId}&part=snippet,contentDetails&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new ServiceUnavailableException('YouTube Data API request failed');

    const json = await res.json();
    const item = json.items?.[0];
    if (!item) throw new BadRequestException('Video not found or not public');

    return {
      title: item.snippet.title,
      durationSeconds: isoDurationToSeconds(item.contentDetails.duration),
      thumbnailUrl: item.snippet.thumbnails?.high?.url ?? item.snippet.thumbnails?.default?.url,
    };
  }
}
