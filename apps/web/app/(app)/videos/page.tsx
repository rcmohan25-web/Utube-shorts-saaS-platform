'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import type { VideoStatusEvent } from '@shorts/shared';

type Video = {
  id: string;
  title: string;
  status: string;
  thumbnailUrl: string | null;
  createdAt: string;
};

type Channel = { id: string; name: string };

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-white/10 text-white/70',
  DOWNLOADING: 'bg-blue-500/20 text-blue-300 animate-pulse',
  DOWNLOADED: 'bg-blue-500/20 text-blue-300',
  TRANSCRIBING: 'bg-blue-500/20 text-blue-300 animate-pulse',
  READY: 'bg-emerald-500/20 text-emerald-300',
  FAILED: 'bg-red-500/20 text-red-300',
};

export default function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [url, setUrl] = useState('');
  const [channelId, setChannelId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [live, setLive] = useState(false);

  const refresh = useCallback(() => {
    apiFetch<Video[]>('/videos').then(setVideos).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    apiFetch<Channel[]>('/channels')
      .then((cs) => {
        setChannels(cs);
        if (cs[0]) setChannelId(cs[0].id);
      })
      .catch(() => {});
  }, [refresh]);

  // §8.3 video:status over WebSocket, org-scoped server-side — replaces the
  // old 5s polling loop. Each event patches just the row that changed.
  useEffect(() => {
    const socket = getSocket();

    function onStatus(event: VideoStatusEvent) {
      setVideos((prev) => prev.map((v) => (v.id === event.videoId ? { ...v, status: event.status } : v)));
    }

    socket.on('connect', () => setLive(true));
    socket.on('disconnect', () => setLive(false));
    socket.on('video:status', onStatus);

    return () => {
      socket.off('video:status', onStatus);
      socket.off('connect');
      socket.off('disconnect');
    };
  }, []);

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!channelId) {
      setError('Connect a channel first (Settings → Channels).');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/videos', {
        method: 'POST',
        body: JSON.stringify({ youtubeUrl: url, channelId }),
      });
      setUrl('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Videos</h1>
        <span className={`flex items-center gap-1.5 text-xs ${live ? 'text-emerald-400' : 'text-white/30'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-emerald-400' : 'bg-white/30'}`} />
          {live ? 'Live' : 'Connecting…'}
        </span>
      </div>

      <form onSubmit={onImport} className="flex gap-2">
        <input
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        >
          {channels.length === 0 && <option value="">No channels yet</option>}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          Import
        </button>
      </form>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {videos.map((v) => (
          <Link
            key={v.id}
            href={`/videos/${v.id}`}
            className="overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:border-brand-500"
          >
            <div className="aspect-video bg-black/40">
              {v.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={v.thumbnailUrl} alt={v.title} className="h-full w-full object-cover" />
              )}
            </div>
            <div className="space-y-1 p-3">
              <div className="truncate text-sm font-medium">{v.title}</div>
              <span className={`inline-block rounded px-2 py-0.5 text-xs ${STATUS_COLOR[v.status] ?? ''}`}>
                {v.status}
              </span>
            </div>
          </Link>
        ))}
        {videos.length === 0 && (
          <p className="col-span-full text-sm text-white/40">
            No videos yet. Paste a YouTube URL above to start the pipeline.
          </p>
        )}
      </div>
    </div>
  );
}
