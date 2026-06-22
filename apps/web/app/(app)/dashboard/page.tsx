'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';

type Video = { id: string; status: string };

export default function DashboardPage() {
  const [videos, setVideos] = useState<Video[]>([]);

  useEffect(() => {
    apiFetch<Video[]>('/videos').then(setVideos).catch(() => setVideos([]));
  }, []);

  const inPipeline = videos.filter((v) => !['READY', 'FAILED'].includes(v.status)).length;
  const ready = videos.filter((v) => v.status === 'READY').length;

  const cards = [
    { label: 'Videos imported', value: videos.length },
    { label: 'In pipeline', value: inPipeline },
    { label: 'Ready for clipping', value: ready },
    { label: 'Review queue', value: 0 }, // wires up once /shorts?status=REVIEW exists
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="text-2xl font-semibold">{c.value}</div>
            <div className="text-sm text-white/50">{c.label}</div>
          </div>
        ))}
      </div>
      <p className="text-sm text-white/40">
        Charts (7-day Shorts, 7-day views) land here once /analytics/overview ships — Week 3 on the roadmap.
      </p>
    </div>
  );
}
