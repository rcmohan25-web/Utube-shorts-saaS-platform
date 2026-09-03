// §20.7 — plan-gated feature flags, kept as one lookup table (not per-call-
// site checks scattered across services) so the whole gating policy is
// auditable in one place, same spirit as notification.types.ts's channel
// matrix. Consumed by apps/api's FeatureGuard and can be reused client-side
// (e.g. to hide an "API keys" nav link) without duplicating the rules.
import type { AuthenticatedUserClaims } from './types';

export type PlanName = AuthenticatedUserClaims['plan'];

export const FLAGS = {
  // Roll out to AGENCY+ only first, per §20.7's rollout note.
  API_ACCESS: (plan: PlanName) => plan === 'AGENCY' || plan === 'ENTERPRISE',
  WHITE_LABEL: (plan: PlanName) => plan === 'AGENCY' || plan === 'ENTERPRISE',
  AGENCY_SUB_ORGS: (plan: PlanName) => plan === 'AGENCY' || plan === 'ENTERPRISE',
  BULK_IMPORT: (plan: PlanName) => plan !== 'STARTER',
  CUSTOM_AI_MODELS: (plan: PlanName) => plan === 'ENTERPRISE',
} as const;

export type FeatureFlagName = keyof typeof FLAGS;
