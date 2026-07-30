'use client';

import { useEffect, useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '@/lib/api-client';

type Overview = {
  totalViews: number;
  totalWatchTimeSeconds: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  avgViewDurationSeconds: number;
  subscribersGained: number;
  publishRate: number;
  bestShortId: string | null;
  series: { date: string; views: number }[];
};

const PRESETS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

function formatWatchTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export default function AnalyticsPage() {
  const [preset, setPreset] = useState(7);
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback((days: number) => {
    setLoading(true);
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    apiFetch<Overview>(`/analytics/overview?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh(preset);
  }, [preset, refresh]);

  const cards = data
    ? [
        { label: 'Total views', value: data.totalViews.toLocaleString() },
        { label: 'Watch time', value: formatWatchTime(data.totalWatchTimeSeconds) },
        { label: 'Avg view duration', value: `${Math.round(data.avgViewDurationSeconds)}s` },
        { label: 'Subscribers gained', value: data.subscribersGained.toLocaleString() },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <div className="flex gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setPreset(p.days)}
              className={`rounded-lg border border-white/10 px-3 py-1.5 text-sm ${
                preset === p.days ? 'bg-brand-500/20 text-brand-500' : 'hover:bg-white/5'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data && <p className="text-sm text-white/40">Loading…</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {cards.map((c) => (
              <div key={c.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-2xl font-semibold">{c.value}</div>
                <div className="text-sm text-white/50">{c.label}</div>
              </div>
            ))}
          </div>

          {data.series.length > 0 ? (
            <div className="h-64 rounded-2xl border border-white/10 bg-white/5 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.series}>
                  <XAxis dataKey="date" stroke="#ffffff40" fontSize={12} />
                  <YAxis stroke="#ffffff40" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ background: '#0b0a13', border: '1px solid #ffffff1a', fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="views" stroke="#6d5bff" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-white/40">
              No analytics data in this range yet. Data appears ~24h after a Short is first published
              (§17.1) — check back after your first sync window, or wait for the next daily sync at
              3am UTC.
            </p>
          )}

          <p className="text-xs text-white/30">
            Publish rate: {data.publishRate.toFixed(2)} Shorts/day in this range
            {data.bestShortId && <> · Best performer: Short {data.bestShortId}</>}
          </p>
        </>
      )}
    </div>
  );
}
