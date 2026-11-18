'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';

type Scope = 'READ_ONLY' | 'READ_WRITE';

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  status: 'ACTIVE' | 'REVOKED';
  scope: Scope;
  lastUsedAt: string | null;
};

const SCOPE_LABEL: Record<Scope, string> = {
  READ_ONLY: 'Read only',
  READ_WRITE: 'Read / write',
};

const SCOPE_COLOR: Record<Scope, string> = {
  READ_ONLY: 'bg-blue-500/20 text-blue-300',
  READ_WRITE: 'bg-amber-500/20 text-amber-300',
};

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<Scope>('READ_WRITE');
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ rawKey: string; scope: Scope } | null>(null);

  const refresh = useCallback(() => {
    apiFetch<ApiKeyRow[]>('/organizations/api-keys')
      .then((k) => { setKeys(k); setError(null); })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load API keys'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const created = await apiFetch<{ rawKey: string; scope: Scope }>('/organizations/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name, scope }),
      });
      setRevealedKey({ rawKey: created.rawKey, scope: created.scope });
      setName('');
      setScope('READ_WRITE');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create API key');
    } finally {
      setCreating(false);
    }
  }

  async function onRevoke(id: string) {
    try {
      await apiFetch(`/organizations/api-keys/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke key');
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API keys</h1>
        <p className="text-sm text-white/50">
          Agency plan and above. Use a key as{' '}
          <code className="text-white/70">Authorization: Bearer sk_live_...</code> against{' '}
          <code className="text-white/70">/api/v1/public/v1/videos</code>. Rate limits and read/write
          access are tracked per key, not per IP.
        </p>
      </div>

      {revealedKey && (
        <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <p className="text-amber-200">Copy this key now — it will not be shown again.</p>
          <code className="block break-all rounded bg-black/40 p-2 text-xs text-white">{revealedKey.rawKey}</code>
          <p className="text-xs text-white/50">
            Scope:{' '}
            <span className={`rounded px-2 py-0.5 ${SCOPE_COLOR[revealedKey.scope]}`}>
              {SCOPE_LABEL[revealedKey.scope]}
            </span>
          </p>
          <button onClick={() => setRevealedKey(null)} className="text-xs text-white/50 hover:text-white/80">
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={onCreate} className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex gap-2">
          <input
            type="text"
            required
            placeholder="Key name (e.g. Zapier integration)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
          />
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          >
            <option value="READ_WRITE">Read / write</option>
            <option value="READ_ONLY">Read only</option>
          </select>
          <button
            type="submit"
            disabled={creating}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </div>
        <p className="text-xs text-white/30">
          Read-only keys can list videos but cannot import new ones. Choose Read / write only for
          integrations that need to trigger imports.
        </p>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex-1">
                <div className="text-sm font-medium">{k.name}</div>
                <div className="text-xs text-white/40">
                  {k.keyPrefix}… ·{' '}
                  {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}
                </div>
              </div>
              <span className={`rounded px-2 py-0.5 text-xs ${SCOPE_COLOR[k.scope]}`}>
                {SCOPE_LABEL[k.scope]}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs ${
                  k.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/40'
                }`}
              >
                {k.status}
              </span>
              {k.status === 'ACTIVE' && (
                <button onClick={() => onRevoke(k.id)} className="text-xs text-red-400 hover:text-red-300">
                  Revoke
                </button>
              )}
            </li>
          ))}
          {keys.length === 0 && <p className="text-sm text-white/40">No API keys yet.</p>}
        </ul>
      )}
    </div>
  );
}
