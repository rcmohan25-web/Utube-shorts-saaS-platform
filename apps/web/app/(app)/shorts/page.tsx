'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import type { ShortReadyEvent } from '@shorts/shared';

type Short = {
  id: string;
  title: string;
  status: string;
  tags: string[];
  createdAt: string;
  channel?: { name: string };
};

type ShortDetail = Short & {
  renderPresignedUrl: string | null;
  thumbnailPresignedUrl: string | null;
};

export default function ShortsPage() {
  const [shorts, setShorts] = useState<Short[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShortDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<Short[]>('/shorts?status=REVIEW').then(setShorts).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // §8.3 short:ready — pushed the moment render-worker's callback creates
  // the Short row, no polling.
  useEffect(() => {
    const socket = getSocket();
    function onShortReady(_event: ShortReadyEvent) {
      refresh();
    }
    socket.on('short:ready', onShortReady);
    return () => socket.off('short:ready', onShortReady);
  }, [refresh]);

  async function openShort(id: string) {
    setOpenId(id);
    setDetail(null);
    setError(null);
    try {
      const d = await apiFetch<ShortDetail>(`/shorts/${id}`);
      setDetail(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load Short');
    }
  }

  async function onApprove(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/shorts/${id}/approve`, { method: 'PATCH' });
      setOpenId(null);
      refresh();
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Review queue</h1>
      <p className="text-sm text-white/50">
        Shorts rendered and waiting for review. Scheduling/publishing isn&apos;t wired up yet — approving here just
        marks it ready for that step once it ships.
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
