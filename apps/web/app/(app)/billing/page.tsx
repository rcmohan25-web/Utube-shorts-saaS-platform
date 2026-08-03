'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';

type Usage = {
  plan: 'STARTER' | 'CREATOR' | 'AGENCY' | 'ENTERPRISE';
  used: number;
  quota: number;
  unlimited: boolean;
};

const PLANS = [
  { id: 'STARTER', name: 'Starter', price: '$29/mo', blurb: '50 Shorts · 1 channel · 1 seat' },
  { id: 'CREATOR', name: 'Creator', price: '$99/mo', blurb: '500 Shorts · 3 channels · 5 seats' },
  { id: 'AGENCY', name: 'Agency', price: '$299/mo', blurb: 'Unlimited Shorts · white-label · API access' },
] as const;

export default function BillingPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const refresh = useCallback(() => {
    apiFetch<Usage>('/billing/usage').then(setUsage).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setBanner('Subscription updated — this can take a few seconds to reflect below.');
      window.history.replaceState({}, '', '/billing');
      // Stripe's webhook may land a moment after the Checkout redirect.
      setTimeout(refresh, 3000);
    } else if (params.get('checkout') === 'cancelled') {
      window.history.replaceState({}, '', '/billing');
    }
  }, [refresh]);

  async function onUpgrade(plan: string) {
    setBusyPlan(plan);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ plan }),
      });
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start checkout');
      setBusyPlan(null);
    }
  }

  async function onManageBilling() {
    setPortalBusy(true);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/billing/portal');
      window.location.href = url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the billing portal');
      setPortalBusy(false);
    }
  }

  const pct = usage && !usage.unlimited && usage.quota > 0
    ? Math.min(100, Math.round((usage.used / usage.quota) * 100))
    : 0;

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="text-sm text-white/50">Manage your plan and see this month&apos;s Shorts usage.</p>
      </div>

      {banner && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {banner}
        </div>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}

      {usage && (
        <section className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Current plan: {usage.plan}</span>
            <button
              onClick={onManageBilling}
              disabled={portalBusy}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs hover:bg-white/5 disabled:opacity-50"
            >
              {portalBusy ? 'Opening…' : 'Manage billing'}
            </button>
          </div>
          {usage.unlimited ? (
            <p className="text-sm text-white/50">Unlimited Shorts this month.</p>
          ) : (
            <>
              <p className="text-sm text-white/50">
                {usage.used} / {usage.quota} Shorts published this month
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={`h-full rounded-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-brand-500'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </>
          )}
        </section>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-5">
            <div>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-2xl font-semibold">{p.price}</div>
              <p className="mt-2 text-xs text-white/50">{p.blurb}</p>
            </div>
            <button
              onClick={() => onUpgrade(p.id)}
              disabled={busyPlan !== null || usage?.plan === p.id}
              className="mt-4 rounded-lg bg-brand-500 py-2 text-sm font-medium hover:bg-brand-600 disabled:opacity-50"
            >
              {usage?.plan === p.id ? 'Current plan' : busyPlan === p.id ? 'Redirecting…' : 'Upgrade'}
            </button>
          </div>
        ))}
      </section>

      <p className="text-xs text-white/30">
        Need Enterprise (custom AI models, SSO, on-premise)? Contact us — Enterprise pricing is
        sales-assisted, not self-serve checkout.
      </p>
    </div>
  );
}
