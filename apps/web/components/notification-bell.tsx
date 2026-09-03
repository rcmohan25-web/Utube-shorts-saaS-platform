'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';
import { getSocket } from '@/lib/socket';
import type { NotificationItem } from '@/lib/notifications';
import type { NotificationEvent } from '@shorts/shared';

// PR 7 (§15 Notifications) — bell icon for the app shell. Loads the last
// 50 notifications on mount, then stays live via the 'notification:new'
// WebSocket event (§8.3) instead of polling.
export function NotificationBell() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    apiFetch<NotificationItem[]>('/notifications').then(setItems).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    function onNew(event: NotificationEvent) {
      setItems((prev) => [
        { ...event, readAt: null, actionUrl: event.actionUrl ?? null },
        ...prev,
      ]);
    }
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, []);

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    await apiFetch(`/notifications/${id}/read`, { method: 'PATCH' }).catch(() => {});
  }

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg px-3 py-2 text-sm hover:bg-white/5"
      >
        Notifications
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[10px]">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-10 mt-2 w-80 space-y-1 rounded-xl border border-white/10 bg-[#0b0a13] p-2 shadow-lg">
          {items.length === 0 && <p className="p-3 text-sm text-white/40">No notifications yet.</p>}
          {items.map((n) => (
            <a
              key={n.id}
              href={n.actionUrl ?? '#'}
              onClick={() => markRead(n.id)}
              className={`block rounded-lg px-3 py-2 text-sm hover:bg-white/5 ${!n.readAt ? 'bg-brand-500/10' : ''}`}
            >
              <div className="font-medium">{n.title}</div>
              <div className="text-xs text-white/50">{n.body}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
