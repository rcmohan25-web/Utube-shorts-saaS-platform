// PR 12 (§15.2 white-label branding pass). Shared between apps/api and
// apps/web so the branding contract can't silently drift — same reasoning
// as audit.ts and feature-flags.ts each living in one place rather than
// being redefined per-consumer.
export type OrganizationBranding = {
  organizationName: string;
  logoUrl: string | null;
  brandColor: string | null;
  whiteLabelEnabled: boolean;
};

export const DEFAULT_BRAND_COLOR = '#6d5bff';
