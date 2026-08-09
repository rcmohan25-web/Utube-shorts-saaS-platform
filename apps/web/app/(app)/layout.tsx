'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationBell } from '@/components/notification-bell';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/videos', label: 'Videos' },
  { href: '/shorts', label: 'Shorts' },
  { href: '/scheduler', label: 'Scheduler' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
  { href: '/billing', label: 'Billing' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-white/10 p-4">
        <div className="mb-6 flex items-center justify-between px-2">
          <span className="text-lg font-semibold">Shorts Pilot</span>
          <NotificationBell />
        </div>
        <nav className="space-y-1">
          {NAV.map((item) => {
            const active = pathname?.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`block rounded-lg px-3 py-2 text-sm ${
                  active ? 'bg-brand-500/20 text-brand-500' : 'text-white/70 hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
