'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';

type ClientRow = {
  id: string;
  name: string;
  plan: string;
  quotaShortsPerMonth: number;
  shortsPublishedThisMonth: number;
  activeChannels: number;
  health: 'green' | 'amber' | 'red';
};

type Dashboard = {
  clientCount: number;
  totalShortsPublishedThisMonth: number;
  clients: ClientRow[];
};

const HEALTH_COLOR: Record<string, string> = {
  green: 'bg-emerald-500/20 text-emerald-300',
  amber: 'bg-amber-500/20 text-amber-300',
  red: 'bg-red-500/20 text-red-300',
};

export default function AgencyPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(() => {
    apiFetch<Dashboard>('/agency/dashboard')
      .then((d) => { setData(d); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load agency dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function onCreateClient(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch('/agency/clients', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create client workspace');
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <p className="text-sm text-white/40">Loading…</p>;

  if (error && !data) {
    return (
      <div className="max-w-lg space-y-2">
        <h1 className="text-2xl font-semibold">Agency</h1>
        <p className="text-sm text-red-400">{error}</p>
        <p className="text-sm text-white/40">
          Agency features require the Agency plan or higher — upgrade from Billing.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agency dashboard</h1>
        <p className="text-sm text-white/50">
          {data?.clientCount ?? 0} client workspace{data?.clientCount === 1 ? '' : 's'} ·{' '}
          {data?.totalShortsPublishedThisMonth ?? 0} Shorts published this month across all clients
        </p>
      </div>

      <form onSubmit={onCreateClient} className="flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-4">
        <input
          type="text"
          required
          placeholder="Client workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <button
          type="submit"
          disabled={creating}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Add client'}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="space-y-2">
        {data?.clients.map((c) => (
          <div key={c.id} className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex-1">
              <div className="text-sm font-medium">{c.name}</div>
              <div className="text-xs text-white/40">
                {c.activeChannels} channel{c.activeChannels === 1 ? '' : 's'} · {c.shortsPublishedThisMonth}/
                {c.quotaShortsPerMonth} Shorts this month
              </div>
            </div>
            <span className={`rounded px-2 py-0.5 text-xs ${HEALTH_COLOR[c.health]}`}>{c.health}</span>
            <span className="rounded bg-white/10 px-2 py-0.5 text-xs text-white/60">{c.plan}</span>
          </div>
        ))}
        {data?.clients.length === 0 && <p className="text-sm text-white/40">No client workspaces yet.</p>}
      </div>
    </div>
  );
}
