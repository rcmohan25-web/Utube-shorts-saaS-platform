'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import type { ShortReadyEvent, ShortPublishedEvent } from '@shorts/shared';

type Short = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  createdAt: string;
  channel?: { id: string; name: string };
};

type ShortDetail = Short & {
  renderPresignedUrl: string | null;
  thumbnailPresignedUrl: string | null;
};

type Channel = { id: string; name: string };

function defaultScheduleTime(): string {
  // Default to 1 hour from now, rounded to the next 15-minute mark —
  // comfortably past the 5-minute minimum enforced server-side.
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  // toISOString gives UTC; datetime-local wants local time without a Z suffix.
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

export default function ShortsPage() {
  const [shorts, setShorts] = useState<Short[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShortDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Schedule modal state — appears after Approve
  const [scheduling, setScheduling] = useState(false);
  const [scheduleChannelId, setScheduleChannelId] = useState('');
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleTime());
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleSuccess, setScheduleSuccess] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<Short[]>('/shorts?status=REVIEW').then(setShorts).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    apiFetch<Channel[]>('/channels').then(setChannels).catch(() => {});
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    function onShortReady(_event: ShortReadyEvent) {
      refresh();
    }
    function onShortPublished(event: ShortPublishedEvent) {
      setScheduleSuccess(`Published to YouTube: youtube.com/watch?v=${event.youtubeVideoId}`);
    }
    socket.on('short:ready', onShortReady);
    socket.on('short:published', onShortPublished);
    return () => {
      socket.off('short:ready', onShortReady);
      socket.off('short:published', onShortPublished);
    };
  }, [refresh]);

  async function openShort(id: string) {
    setOpenId(id);
    setDetail(null);
    setError(null);
    setScheduling(false);
    setScheduleError(null);
    setScheduleSuccess(null);
    try {
      const d = await apiFetch<ShortDetail>(`/shorts/${id}`);
      setDetail(d);
      if (d.channel?.id) setScheduleChannelId(d.channel.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Short');
    }
  }

  // Approve now transitions REVIEW -> APPROVED, then reveals the schedule form.
  // Publishing itself only happens once the user picks a time and submits.
  async function onApprove(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/shorts/${id}/approve`, { method: 'PATCH' });
      setScheduling(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve');
    } finally {
      setBusy(false);
    }
  }

  async function onReject(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/shorts/${id}/reject`, { method: 'PATCH', body: JSON.stringify({}) });
      setOpenId(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reject');
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitSchedule() {
    if (!detail) return;
    setScheduleError(null);
    setBusy(true);
    try {
      // datetime-local gives local time with no offset — convert to a real
      // ISO/UTC instant before sending.
      const iso = new Date(scheduleAt).toISOString();
      await apiFetch('/schedules', {
        method: 'POST',
        body: JSON.stringify({
          shortId: detail.id,
          channelId: scheduleChannelId,
          scheduledAt: iso,
        }),
      });
      setScheduleSuccess(
        `Scheduled for ${new Date(scheduleAt).toLocaleString()}. It will publish automatically.`,
      );
      setScheduling(false);
      refresh();
    } catch (err) {
      setScheduleError(err instanceof ApiError ? err.message : 'Could not schedule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Review queue</h1>
      <p className="text-sm text-white/50">
        Shorts rendered and waiting for review. Approve to move on to scheduling — you&apos;ll pick
        the publish time in the next step.
      </p>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {shorts.map((s) => (
          <button
            key={s.id}
            onClick={() => openShort(s.id)}
            className="overflow-hidden rounded-xl border border-white/10 bg-white/5 text-left hover:border-brand-500"
          >
            <div className="aspect-[9/16] bg-black/40" />
            <div className="space-y-1 p-3">
              <div className="truncate text-sm font-medium">{s.title}</div>
              <div className="text-xs text-white/40">{s.channel?.name}</div>
            </div>
          </button>
        ))}
        {shorts.length === 0 && (
          <p className="col-span-full text-sm text-white/40">
            Nothing in review yet. Approve a clip on a video&apos;s detail page to start a render.
          </p>
        )}
      </div>

      {openId && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpenId(null)}
        >
          <div
            className="max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#0b0a13] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {detail ? (
              <>
                {detail.renderPresignedUrl ? (
                  <video
                    src={detail.renderPresignedUrl}
                    controls
                    className="aspect-[9/16] w-full rounded-lg bg-black"
                  />
                ) : (
                  <div className="aspect-[9/16] w-full rounded-lg bg-black/60" />
                )}
                <div>
                  <div className="text-sm font-medium">{detail.title}</div>
                  <div className="text-xs text-white/40">{detail.tags?.join(' ')}</div>
                </div>

                {scheduleSuccess && (
                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                    {scheduleSuccess}
                  </div>
                )}

                {!scheduling && !scheduleSuccess && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onApprove(detail.id)}
                      disabled={busy}
                      className="flex-1 rounded-lg bg-brand-500 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => onReject(detail.id)}
                      disabled={busy}
                      className="flex-1 rounded-lg border border-white/10 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}

                {scheduling && (
                  <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
                    <div className="space-y-1">
                      <label className="text-xs text-white/60">Channel</label>
                      <select
                        value={scheduleChannelId}
                        onChange={(e) => setScheduleChannelId(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                      >
                        {channels.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-white/60">Publish time</label>
                      <input
                        type="datetime-local"
                        value={scheduleAt}
                        onChange={(e) => setScheduleAt(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
                      />
                    </div>
                    {scheduleError && <p className="text-xs text-red-400">{scheduleError}</p>}
                    <button
                      onClick={onSubmitSchedule}
                      disabled={busy || !scheduleChannelId}
                      className="w-full rounded-lg bg-brand-500 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
                    >
                      {busy ? 'Scheduling…' : 'Confirm schedule'}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-white/40">Loading…</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
