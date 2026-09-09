'use client';

import { useEffect, useState } from 'react';
import type { OrganizationBranding } from '@shorts/shared';
import { apiFetch } from './api-client';

const FALLBACK: OrganizationBranding = {
  organizationName: 'Shorts Pilot',
  logoUrl: null,
  brandColor: null,
  whiteLabelEnabled: false,
};

// PR 12 (§15.2 white-label branding pass). Fetches this org's branding
// once per app-shell mount and applies the brand color as a CSS custom
// property (--brand-color) so components can opt into it without a
// per-org rebuild. Falls back to the platform default on any failure —
// branding is cosmetic, never a hard dependency for the app to render.
export function useBranding(): OrganizationBranding {
  const [branding, setBranding] = useState<OrganizationBranding>(FALLBACK);

  useEffect(() => {
    apiFetch<OrganizationBranding>('/organizations/branding')
      .then((b) => {
        setBranding(b);
        if (b.brandColor) {
          document.documentElement.style.setProperty('--brand-color', b.brandColor);
        }
      })
      .catch(() => setBranding(FALLBACK));
  }, []);

  return branding;
}
