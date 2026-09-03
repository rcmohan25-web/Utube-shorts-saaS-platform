'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { AUDIT_ACTIONS } from '@shorts/shared';
import type { AuditLogPage, AuditLogRow } from '@shorts/shared';

function actionLabel(action: string) {
  // 'user.role_changed' -> 'user · role changed'
  const [resource, verb] = action.split('.');
  return `${resource} · ${verb?.replace(/_/g, ' ') ?? ''}`;
}

function formatMetadata(metadata: Record<string, unknown> | null) {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return Object.entries(metadata)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [actionFilter, setActionFilter] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const buildQuery = useCallback(
    (cursor?: string) => {
      const params = new URLSearchParams();
      if (actionFilter) params.set('action', actionFilter);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      if (cursor) params.set('cursor', cursor);
      return params.toString();
    },
    [actionFilter, from, to],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<AuditLogPage>(`/audit-log?${buildQuery()}`)
      .then((page) => {
        setRows(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load audit log'))
      .finally(() => setLoading(false));
  }, [buildQuery]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await apiFetch<AuditLogPage>(`/audit-log?${buildQuery(nextCursor)}`);
      setRows((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load more entries');
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Audit log</h1>
        <p className="text-sm text-white/50">
          Every destructive action taken in this workspace — who, what, and when.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="space-y-1">
          <label className="text-xs text-white/60">Action</label>
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>{actionLabel(a)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-white/60">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-white/60">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
          />
        </div>
        <button
          onClick={refresh}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600"
        >
          Apply filters
        </button>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase text-white/40">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Resource</th>
                <th className="px-4 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-white/10">
                  <td className="whitespace-nowrap px-4 py-2 text-white/60">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-medium">{actionLabel(r.action)}</td>
                  <td className="px-4 py-2 text-white/60">{r.userId ?? 'system'}</td>
                  <td className="px-4 py-2 text-white/60">
                    {r.resourceType ? `${r.resourceType}:${r.resourceId ?? '—'}` : '—'}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2 text-white/40" title={formatMetadata(r.metadata) ?? ''}>
                    {formatMetadata(r.metadata) ?? '—'}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-white/40">
                    No audit entries match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {nextCursor && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}
