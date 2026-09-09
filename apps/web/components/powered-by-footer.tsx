'use client';

import type { OrganizationBranding } from '@shorts/shared';

// PR 12 (§15.2): "Remove all 'Powered by' attribution from every
// touchpoint" for Agency+ orgs. Every other plan keeps the footer — it's
// low-cost distribution for the platform and expected at Starter/Creator
// pricing, same spirit as free-tier watermarks elsewhere in the industry.
export function PoweredByFooter({ branding }: { branding: OrganizationBranding }) {
  if (branding.whiteLabelEnabled) return null;

  return (
    <p className="px-2 pb-2 text-center text-[11px] text-white/20">
      Powered by <span className="text-white/30">Shorts Pilot</span>
    </p>
  );
}
