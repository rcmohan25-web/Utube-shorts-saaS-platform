// PR 11 (§9.4 follow-up: Audit Log Admin UI).
// Mirrors apps/api/src/audit/audit-log.service.ts's AuditAction union.
// Kept here (not just in the API) so the frontend filter dropdown can't
// silently drift from what the backend actually accepts — same reasoning
// as NOTIFICATION_CHANNELS living in one place rather than duplicated.
export const AUDIT_ACTIONS = [
  'channel.disconnect',
  'clip.reject',
  'short.reject',
  'schedule.cancel',
  'user.role_changed',
  'user.deactivated',
  'user.reactivated',
  'invitation.revoked',
  'organization.branding_updated',
  'agency.client_created',
  'apikey.created',
  'apikey.revoked',
] as const;

export type AuditActionName = (typeof AUDIT_ACTIONS)[number];

export type AuditLogRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  action: AuditActionName | string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
};

export type AuditLogPage = {
  items: AuditLogRow[];
  nextCursor: string | null;
};
