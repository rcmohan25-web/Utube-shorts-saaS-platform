'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import type { ClipCreatedEvent, VideoStatusEvent } from '@shorts/shared';

type Clip = {
  id: string;
  startSeconds: number;
  endSeconds: number;
  confidenceScore: number;
  transcriptSegment: string | null;
  aiReasoning: string | null;
  suggestedTitle: string | null;
  suggestedHashtags: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
};

type VideoDetail = {
  id: string;
  title: string;
  status: string;
  thumbnailUrl: string | null;
  clips: Clip[];
};

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoDetailPage() {
  const params = useParams<{ id: string }>();
  const videoId = params.id;

  const [video, setVideo] = useState<VideoDetail | null>(null);
  const [busyClipId, setBusyClipId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<VideoDetail>(`/videos/${videoId}`).then(setVideo).catch(() => {});
  }, [videoId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Live updates: clip:created as GPT-4o finishes scoring, video:status for
  // this video's own pipeline stage (§8.3) — no manual refresh needed.
  useEffect(() => {
    const socket = getSocket();

    function onClipCreated(event: ClipCreatedEvent) {
      if (event.videoId === videoId) refresh();
    }
    function onVideoStatus(event: VideoStatusEvent) {
      if (event.videoId === videoId) refresh();
    }

    socket.on('clip:created', onClipCreated);
    socket.on('video:status', onVideoStatus);
    return () => {
      socket.off('clip:created', onClipCreated);
      socket.off('video:status', onVideoStatus);
    };
  }, [videoId, refresh]);

  async function onApprove(clipId: string) {
    setBusyClipId(clipId);
    setNotice(null);
    try {
      await apiFetch(`/clips/${clipId}/approve`, { method: 'PATCH' });
      setNotice('Approved — rendering started. It will appear in the Shorts review queue when ready.');
      refresh();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not approve clip');
    } finally {
      setBusyClipId(null);
    }
  }

  async function onReject(clipId: string) {
    setBusyClipId(clipId);
    try {
      await apiFetch(`/clips/${clipId}/reject`, { method: 'PATCH', body: JSON.stringify({}) });
      refresh();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Could not reject clip');
    } finally {
      setBusyClipId(null);
    }
  }

  if (!video) return <p className="text-sm text-white/40">Loading…</p>;

  const clips = [...video.clips].sort((a, b) => b.confidenceScore - a.confidenceScore);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {video.thumbnailUrl && (
          <img src={video.thumbnailUrl} alt={video.title} className="h-16 w-28 rounded-lg object-cover" />
        )}
        <div>
          <h1 className="text-xl font-semibold">{video.title}</h1>
          <p className="text-sm text-white/40">Status: {video.status}</p>
        </div>
      </div>

      {notice && <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">{notice}</div>}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-white/70">
          Clips {clips.length > 0 && `(${clips.length}, sorted by confidence)`}
        </h2>

        {video.status !== 'READY' && clips.length === 0 && (
          <p className="text-sm text-white/40">
            Clips appear here once transcription finishes and GPT-4o scores the candidates.
          </p>
        )}
        {video.status === 'READY' && clips.length === 0 && (
          <p className="text-sm text-white/40">Scoring clips now — this can take a minute or two.</p>
        )}

        <ul className="space-y-3">
          {clips.map((c) => (
            <li key={c.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-brand-500/20 px-2 py-0.5 text-xs font-medium text-brand-500">
                      {Math.round(c.confidenceScore)}
                    </span>
                    <span className="text-sm font-medium">{c.suggestedTitle ?? 'Untitled clip'}</span>
                  </div>
                  <p className="text-xs text-white/40">
                    {formatTime(c.startSeconds)}–{formatTime(c.endSeconds)}
                    {c.suggestedHashtags?.length > 0 && <> · {c.suggestedHashtags.join(' ')}</>}
                  </p>
                  {c.transcriptSegment && (
                    <p className="line-clamp-2 text-sm text-white/60">&ldquo;{c.transcriptSegment}&rdquo;</p>
                  )}
                  {c.aiReasoning && <p className="text-xs italic text-white/30">{c.aiReasoning}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      c.status === 'APPROVED'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : c.status === 'REJECTED'
                          ? 'bg-white/10 text-white/40'
                          : 'bg-blue-500/20 text-blue-300'
                    }`}
                  >
                    {c.status}
                  </span>
                  {c.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onApprove(c.id)}
                        disabled={busyClipId === c.id}
                        className="rounded-lg bg-brand-500 px-3 py-1 text-xs font-medium hover:bg-brand-600 disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => onReject(c.id)}
                        disabled={busyClipId === c.id}
                        className="rounded-lg border border-white/10 px-3 py-1 text-xs hover:bg-white/5 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
