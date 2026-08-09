// §15.1 notification type -> channel matrix. Kept as a plain lookup table
// (not per-call flags scattered across trigger sites) so the whole channel
// policy is auditable in one place, same spirit as video-status.machine.ts's
// VALID_TRANSITIONS table.
export type NotificationType =
  | 'SHORTS_READY'
  | 'SHORT_PUBLISHED'
  | 'PIPELINE_FAILURE'
  | 'QUOTA_WARNING'
  | 'QUOTA_EXCEEDED'
  | 'PAYMENT_FAILED'
  | 'WEEKLY_DIGEST';

export type NotificationChannels = { email: boolean; slack: boolean; inApp: boolean };

export const NOTIFICATION_CHANNELS: Record<NotificationType, NotificationChannels> = {
  SHORTS_READY: { email: true, slack: false, inApp: true },
  SHORT_PUBLISHED: { email: false, slack: true, inApp: true },
  PIPELINE_FAILURE: { email: true, slack: true, inApp: true },
  QUOTA_WARNING: { email: true, slack: false, inApp: true },
  QUOTA_EXCEEDED: { email: true, slack: false, inApp: true },
  PAYMENT_FAILED: { email: true, slack: false, inApp: true },
  WEEKLY_DIGEST: { email: true, slack: false, inApp: false },
};
