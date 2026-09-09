'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NotificationBell } from '@/components/notification-bell';
import { PoweredByFooter } from '@/components/powered-by-footer';
import { useBranding } from '@/lib/branding';

const NAV = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/videos', label: 'Videos' },
  { href: '/shorts', label: 'Shorts' },
  { href: '/scheduler', label: 'Scheduler' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/agency', label: 'Agency' },
  { href: '/settings', label: 'Settings' },
  { href: '/settings/branding', label: 'Branding' },
  { href: '/settings/users', label: 'Team' },
  { href: '/settings/api-keys', label: 'API keys' },
  { href: '/settings/audit-log', label: 'Audit log' },
  { href: '/billing', label: 'Billing' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // PR 12 (§15.2): the sidebar now shows this org's own logo/name once
  // set, instead of the hardcoded "Shorts Pilot" wordmark — the first and
  // most-seen surface in the whole app for the branding pass to land on.
  const branding = useBranding();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-white/10 p-4">
        <div className="mb-6 flex items-center justify-between px-2">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.organizationName}
              className="h-7 max-w-[140px] object-contain"
            />
          ) : (
            <span className="text-lg font-semibold">
              {branding.whiteLabelEnabled ? branding.organizationName : 'Shorts Pilot'}
            </span>
          )}
          <NotificationBell />
        </div>
        <nav className="flex-1 space-y-1">
          {NAV.map((item) => {
            // Exact match for /settings so it doesn't also light up for
            // /settings/branding, /settings/users, /settings/api-keys,
            // /settings/audit-log — all under the same prefix.
            const active =
              item.href === '/settings' ? pathname === '/settings' : pathname?.startsWith(item.href);
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
        {/* PR 12: hidden automatically once this org's plan unlocks white-label. */}
        <PoweredByFooter branding={branding} />
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
