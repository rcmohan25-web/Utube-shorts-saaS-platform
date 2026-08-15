'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';

type Role = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';

type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'ACTIVE' | 'DEACTIVATED';
  createdAt: string;
};

type Invitation = {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  createdAt: string;
};

const ROLES: Role[] = ['OWNER', 'ADMIN', 'EDITOR', 'VIEWER'];
const INVITE_ROLES: Role[] = ['ADMIN', 'EDITOR', 'VIEWER']; // Owner isn't grantable via invite

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('EDITOR');
  const [inviting, setInviting] = useState(false);

  const refresh = useCallback(() => {
    Promise.all([
      apiFetch<Member[]>('/organizations/users'),
      apiFetch<Invitation[]>('/organizations/users/invitations'),
    ])
      .then(([m, i]) => {
        setMembers(m);
        setInvitations(i);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load team'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch('/organizations/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setNotice(`Invite sent to ${inviteEmail}.`);
      setInviteEmail('');
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send invite');
    } finally {
      setInviting(false);
    }
  }

  async function onRoleChange(userId: string, role: Role) {
    setError(null);
    try {
      await apiFetch(`/organizations/users/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update role');
    }
  }

  async function onToggleStatus(member: Member) {
    setError(null);
    const action = member.status === 'ACTIVE' ? 'deactivate' : 'reactivate';
    try {
      await apiFetch(`/organizations/users/${member.id}/${action}`, { method: 'PATCH' });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} member`);
    }
  }

  async function onRevoke(id: string) {
    setError(null);
    try {
      await apiFetch(`/organizations/users/invitations/${id}`, { method: 'DELETE' });
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not revoke invite');
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Team</h1>
        <p className="text-sm text-white/50">Invite teammates and manage their access.</p>
      </div>

      {notice && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      <form onSubmit={onInvite} className="flex gap-2 rounded-2xl border border-white/10 bg-white/5 p-4">
        <input
          type="email"
          required
          placeholder="teammate@company.com"
          value={inviteEmail}
          onChange={(e) => setInviteEmail(e.target.value)}
          className="flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-brand-500"
        />
        <select
          value={inviteRole}
          onChange={(e) => setInviteRole(e.target.value as Role)}
          className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm"
        >
          {INVITE_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={inviting}
          className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
        >
          {inviting ? 'Sending…' : 'Invite'}
        </button>
      </form>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-white/70">Members</h2>
        {loading ? (
          <p className="text-sm text-white/40">Loading…</p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{m.name}</div>
                  <div className="text-xs text-white/40">{m.email}</div>
                </div>
                <select
                  value={m.role}
                  disabled={m.role === 'OWNER'}
                  onChange={(e) => onRoleChange(m.id, e.target.value as Role)}
                  className="rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs disabled:opacity-50"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r} disabled={r === 'OWNER'}>{r}</option>
                  ))}
                </select>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    m.status === 'ACTIVE' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-white/40'
                  }`}
                >
                  {m.status}
                </span>
                {m.role !== 'OWNER' && (
                  <button onClick={() => onToggleStatus(m)} className="text-xs text-red-400 hover:text-red-300">
                    {m.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {invitations.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-white/70">Pending invitations</h2>
          <ul className="space-y-2">
            {invitations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <div className="flex-1">
                  <div className="text-sm font-medium">{i.email}</div>
                  <div className="text-xs text-white/40">
                    Invited as {i.role} · expires {new Date(i.expiresAt).toLocaleDateString()}
                  </div>
                </div>
                <button onClick={() => onRevoke(i.id)} className="text-xs text-red-400 hover:text-red-300">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
