import type { NotificationType } from './notification.types';

type BuiltMessage = { title: string; body: string; actionUrl?: string };

// One place that turns (type, payload) into human-readable copy. Trigger
// sites only ever pass structured payload — never pre-formatted strings —
// so wording changes never require touching six different call sites.
export function buildNotificationMessage(
  type: NotificationType,
  payload: Record<string, unknown>,
): BuiltMessage {
  switch (type) {
    case 'SHORTS_READY':
      return {
        title: `${payload.reviewCount} Short${payload.reviewCount === 1 ? '' : 's'} ready for review`,
        body: `${payload.reviewCount} Short${payload.reviewCount === 1 ? '' : 's'} finished rendering and are waiting for your approval.`,
        actionUrl: '/shorts',
      };

    case 'SHORT_PUBLISHED':
      return {
        title: 'Short published to YouTube',
        body: `"${payload.title ?? 'Your Short'}" is now live on YouTube.`,
        actionUrl: payload.youtubeVideoId ? `https://youtube.com/watch?v=${payload.youtubeVideoId}` : '/shorts',
      };

    case 'PIPELINE_FAILURE':
      return {
        title: 'Pipeline failure',
        body: payload.errorMessage
          ? `Processing failed: ${payload.errorMessage}`
          : 'A processing step failed after all retries.',
        actionUrl: payload.videoId ? `/videos/${payload.videoId}` : '/videos',
      };

    case 'QUOTA_WARNING':
      return {
        title: `You've used ${payload.pct}% of your monthly Shorts quota`,
        body: `${payload.pct}% used — ${payload.used}/${payload.quota} Shorts published this month. Upgrade to avoid an interruption.`,
        actionUrl: '/billing',
      };

    case 'QUOTA_EXCEEDED':
      return {
        title: 'Monthly Shorts quota reached',
        body: `You've hit your ${payload.quota}-Short monthly limit. New Shorts can't be scheduled until you upgrade or next month starts.`,
        actionUrl: '/billing',
      };

    case 'PAYMENT_FAILED':
      return {
        title: 'Payment failed',
        body: 'Your most recent invoice payment did not go through. Update your payment method to avoid a service interruption.',
        actionUrl: '/billing',
      };

    case 'WEEKLY_DIGEST':
      return {
        title: 'Your weekly Shorts digest',
        body:
          `${payload.publishedCount} Short${payload.publishedCount === 1 ? '' : 's'} published, ` +
          `${payload.totalViews} views this week.` +
          (payload.bestShortId ? ` Top performer: Short ${payload.bestShortId}.` : ''),
        actionUrl: '/analytics',
      };

    default: {
      const _exhaustive: never = type;
      throw new Error(`Unhandled notification type: ${_exhaustive}`);
    }
  }
}
