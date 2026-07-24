'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import type { ShortPublishedEvent } from '@shorts/shared';

type ScheduleItem = {
  id: string;
  scheduledAt: string;
  status: 'PENDING' | 'PUBLISHED' | 'FAILED' | 'CANCELLED';
  youtubeVideoId: string | null;
  lastError: string | null;
  short: {
    id: string;
    title: string;
    thumbnailPresignedUrl: string | null;
  };
  channel: {
    id: string;
    name: string;
  };
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  PUBLISHED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  FAILED: 'bg-red-500/20 text-red-300 border-red-500/30',
  CANCELLED: 'bg-white/10 text-white/40 border-white/10',
};

function startOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + n);
  return date;
}

export default function SchedulerPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [selected, setSelected] = useState<ScheduleItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const weekEnd = addDays(weekStart, 7);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const refresh = useCallback(() => {
    apiFetch<ScheduleItem[]>(
      `/schedules?from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`,
    )
      .then(setSchedules)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart.getTime()]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    function onPublished(_event: ShortPublishedEvent) {
      refresh();
    }
    socket.on('short:published', onPublished);
    socket.on('quota:warning', refresh);
    return () => {
      socket.off('short:published', onPublished);
      socket.off('quota:warning', refresh);
    };
  }, [refresh]);

  async function onCancel(scheduleId: string) {
    setCancelling(true);
    setError(null);
    try {
      await apiFetch(`/schedules/${scheduleId}`, { method: 'DELETE' });
      setSelected(null);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not cancel');
    } finally {
      setCancelling(false);
    }
  }

  function schedulesForDay(day: Date) {
    const dayStr = day.toDateString();
    return schedules
      .filter((s) => new Date(s.scheduledAt).toDateString() === dayStr)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }

  // §11.4: daily upload limit indicator — YouTube hard caps at 100/channel/day.
  // Group by channel to show per-channel counts for the week at a glance.
  const channelCounts = schedules.reduce<Record<string, number>>((acc, s) => {
    acc[s.channel.name] = (acc[s.channel.name] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Scheduler</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            ← Prev
          </button>
          <span className="text-sm text-white/60">
            {weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} –{' '}
            {addDays(weekStart, 6).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </span>
          <button
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5"
          >
            Next →
          </button>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date()))}
            className="rounded-lg bg-brand-500/20 px-3 py-1.5 text-sm text-brand-500 hover:bg-brand-500/30"
          >
            Today
          </button>
        </div>
      </div>

      {Object.keys(channelCounts).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-white/50">
          {Object.entries(channelCounts).map(([name, count]) => (
            <span key={name} className="rounded-full border border-white/10 px-3 py-1">
              {name}: {count}/day cap 100
            </span>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const items = schedulesForDay(day);
          const isToday = day.toDateString() === new Date().toDateString();
          return (
            <div
              key={day.toISOString()}
              className={`min-h-[200px] space-y-2 rounded-xl border p-2 ${
                isToday ? 'border-brand-500/50 bg-brand-500/5' : 'border-white/10 bg-white/5'
              }`}
            >
              <div className="text-xs font-medium text-white/60">
                {day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}
              </div>
              <div className="space-y-1">
                {items.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelected(s)}
                    className={`w-full truncate rounded-lg border px-2 py-1.5 text-left text-xs ${STATUS_COLOR[s.status]}`}
                  >
                    <div className="truncate font-medium">{s.short.title}</div>
                    <div className="text-[10px] opacity-70">
                      {new Date(s.scheduledAt).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}{' '}
                      · {s.channel.name}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-2xl border border-white/10 bg-[#0b0a13] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            {selected.short.thumbnailPresignedUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={selected.short.thumbnailPresignedUrl}
                alt={selected.short.title}
                className="aspect-video w-full rounded-lg object-cover"
              />
            )}
            <div>
              <div className="text-sm font-medium">{selected.short.title}</div>
              <div className="text-xs text-white/40">{selected.channel.name}</div>
            </div>
            <div className="space-y-1 text-xs text-white/60">
              <div>
                Scheduled: {new Date(selected.scheduledAt).toLocaleString()}
              </div>
              <div className="flex items-center gap-2">
                Status:
                <span className={`rounded px-2 py-0.5 ${STATUS_COLOR[selected.status]}`}>
                  {selected.status}
                </span>
              </div>
              {selected.youtubeVideoId && (
                <a
                  href={`https://youtube.com/watch?v=${selected.youtubeVideoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="block text-brand-500 hover:underline"
                >
                  View on YouTube →
                </a>
              )}
              {selected.lastError && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-red-300">
                  {selected.lastError}
                </div>
              )}
            </div>
            {selected.status === 'PENDING' && (
              <button
                onClick={() => onCancel(selected.id)}
                disabled={cancelling}
                className="w-full rounded-lg border border-red-500/30 py-2 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {cancelling ? 'Cancelling…' : 'Cancel schedule'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
