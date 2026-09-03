'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';

type Channel = {
  id: string;
  name: string;
  youtubeChannelId: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  isActive: boolean;
};

export default function SettingsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const refresh = useCallback(() => {
    apiFetch<Channel[]>('/channels')
      .then(setChannels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Pick up ?channelConnected=true / ?error=... left by the OAuth redirect
  // (§14.1), then clean the URL so a refresh doesn't re-show the banner.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('channelConnected') === 'true') {
      setBanner({ type: 'success', message: 'YouTube channel connected.' });
      window.history.replaceState({}, '', '/settings');
    } else if (params.get('error')) {
      setBanner({
        type: 'error',
        message: decodeURIComponent(params.get('error') ?? 'Connection failed'),
      });
      window.history.replaceState({}, '', '/settings');
    }
  }, []);

  async function onConnect() {
    setConnecting(true);
    setBanner(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/auth/youtube/connect');
      window.location.href = url;
    } catch (err) {
      setBanner({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Could not start the YouTube connect flow',
      });
      setConnecting(false);
    }
  }

  async function onDisconnect(id: string) {
    try {
      await apiFetch(`/channels/${id}/disconnect`, { method: 'PATCH' });
      refresh();
    } catch (err) {
      setBanner({
        type: 'error',
        message: err instanceof ApiError ? err.message : 'Could not disconnect channel',
      });
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-white/50">Connect the YouTube channels this workspace publishes to.</p>
      </div>

      {banner && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            banner.type === 'success'
              ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
              : 'border-red-500/20 bg-red-500/10 text-red-300'
          }`}
        >
          {banner.message}
        </div>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-white/70">Connected channels</h2>
          <button
            onClick={onConnect}
            disabled={connecting}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {connecting ? 'Redirecting…' : 'Connect YouTube channel'}
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : channels.length === 0 ? (
          <p className="text-sm text-white/40">
            No channels connected yet. Click &ldquo;Connect YouTube channel&rdquo; to start the OAuth flow.
          </p>
        ) : (
          <ul className="space-y-2">
            {channels.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
              >
                <div className="h-10 w-10 overflow-hidden rounded-full bg-black/40">
                  {c.thumbnailUrl && (
                    <img src={c.thumbnailUrl} alt={c.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-white/40">
                    {c.subscriberCount != null
                      ? `${c.subscriberCount.toLocaleString()} subscribers`
                      : c.youtubeChannelId}
                  </div>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    c.isActive ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/50'
                  }`}
                >
                  {c.isActive ? 'Active' : 'Disconnected'}
                </span>
                {c.isActive && (
                  <button onClick={() => onDisconnect(c.id)} className="text-xs text-red-400 hover:text-red-300">
                    Disconnect
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
