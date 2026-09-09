import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { subDays } from 'date-fns';
import { UserRole } from '@shorts/db';
import { FLAGS } from '@shorts/shared';
import type { NotificationType } from '@shorts/shared';
import { PrismaService } from '../prisma/prisma.service';
import { VideoGateway } from '../websockets/video.gateway';
import { QUEUE_NAMES } from '../queues/queue.constants';
import { EmailService, type EmailBranding } from './email.service';
import { SlackService } from './slack.service';

// §15.1 channel matrix. TEAM_INVITE is handled by a dedicated method
// (invitee isn't an org member yet, so there's no in-app/Slack target).
const CHANNELS: Record<NotificationType, { email: boolean; inApp: boolean; slack: boolean }> = {
  SHORTS_READY: { email: true, inApp: true, slack: false },
  SHORT_PUBLISHED: { email: false, inApp: true, slack: true },
  PIPELINE_FAILURE: { email: true, inApp: true, slack: true },
  QUOTA_WARNING: { email: true, inApp: true, slack: false },
  QUOTA_EXCEEDED: { email: true, inApp: true, slack: false },
  TEAM_INVITE: { email: true, inApp: false, slack: false },
  PAYMENT_FAILED: { email: true, inApp: true, slack: false },
  WEEKLY_DIGEST: { email: true, inApp: false, slack: false },
};

const BATCH_WINDOW_MS = Number(process.env.NOTIFICATIONS_BATCH_WINDOW_MS ?? 15 * 60 * 1000);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private slack: SlackService,
    private videoGateway: VideoGateway,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION) private notificationQueue: Queue,
  ) {}

  // Public entrypoint. SHORTS_READY is special-cased into a debounced
  // BullMQ job (jobId dedupe = free batching, same trick as every other
  // idempotent job add in this codebase) so N renders in a burst produce
  // exactly one email, per §15.1's "max 1 email/hour".
  async notify(type: NotificationType, organizationId: string, metadata: Record<string, unknown> = {}): Promise<void> {
    if (type === 'SHORTS_READY') {
      await this.notificationQueue.add(
        'shorts-ready-batch',
        { organizationId },
        { jobId: `shorts-ready_${organizationId}`, delay: BATCH_WINDOW_MS },
      );
      return;
    }
    return this.send(type, organizationId, metadata);
  }

  // Actual dispatch — also called directly by NotificationBatchProcessor
  // once the batching window elapses.
  async send(type: NotificationType, organizationId: string, metadata: Record<string, unknown> = {}): Promise<void> {
    const { title, body, actionUrl } = this.buildContent(type, metadata);
    const channels = CHANNELS[type];

    if (channels.inApp) {
      const notif = await this.prisma.client.notification.create({
        data: { organizationId, type, title, body, actionUrl, metadata: metadata as never },
      });
      this.videoGateway.emitNotification(organizationId, {
        id: notif.id,
        type,
        title,
        body,
        actionUrl,
        createdAt: notif.createdAt.toISOString(),
      });
    }

    if (channels.email) {
      const recipients = await this.recipientsFor(organizationId, type);
      const branding = await this.brandingFor(organizationId);
      await Promise.all(recipients.map((r) => this.email.send(r.email, title, body, actionUrl, branding)));
    }

    if (channels.slack) {
      const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
      if (org?.webhookUrl) await this.slack.post(org.webhookUrl, `*${title}*\n${body}`);
    }
  }

  // §15.1 "Team invite" — invitee has no org yet, so this bypasses the
  // usual in-app/Slack path entirely and just emails the invite link.
  // PR 12: still branded — the invitee's very first touchpoint with the
  // workspace should already look like that workspace, not the platform.
  async notifyTeamInvite(email: string, organizationName: string, inviteUrl: string): Promise<void> {
    await this.email.send(
      email,
      `You've been invited to join ${organizationName} on Shorts Pilot`,
      `Join the workspace to start reviewing and publishing Shorts. This link expires in 48 hours.`,
      inviteUrl,
    );
  }

  // §17.1-adjacent: every Monday, one digest per org with activity.
  @Cron('0 9 * * 1')
  async weeklyDigest(): Promise<void> {
    const orgs = await this.prisma.client.organization.findMany({ select: { id: true } });
    const from = subDays(new Date(), 7);

    for (const org of orgs) {
      const rows = await this.prisma.client.analyticsDaily.findMany({
        where: { organizationId: org.id, date: { gte: from } },
      });
      const publishedCount = await this.prisma.client.short.count({
        where: { organizationId: org.id, status: 'PUBLISHED', updatedAt: { gte: from } },
      });
      if (rows.length === 0 && publishedCount === 0) continue; // nothing to report, skip the org

      const totalViews = rows.reduce((sum, r) => sum + r.views, 0);
      const byShort = new Map<string, number>();
      for (const r of rows) byShort.set(r.shortId, (byShort.get(r.shortId) ?? 0) + r.views);
      let topTitle: string | null = null;
      let bestViews = -1;
      for (const [shortId, views] of byShort) {
        if (views > bestViews) {
          bestViews = views;
          const s = await this.prisma.client.short.findUnique({ where: { id: shortId }, select: { title: true } });
          topTitle = s?.title ?? null;
        }
      }

      try {
        await this.send('WEEKLY_DIGEST', org.id, { shortsPublished: publishedCount, totalViews, topShortTitle: topTitle });
      } catch (err) {
        this.logger.error({ msg: 'notifications.weekly_digest_failed', organizationId: org.id, reason: (err as Error).message });
      }
    }
  }

  // PR 12 (§15.2): resolves this org's logo/color/plan into the shape
  // EmailService needs. Deliberately does NOT presign the logo S3 key here
  // — a presigned GET URL expires in 60 minutes, but emails sit unread in
  // inboxes for days, and a broken <img> in a week-old email is worse than
  // no logo at all. Falls back to the org name as text until white-label
  // custom domains ship a stable public asset URL (see README "Known
  // follow-ups"); the app shell and Short overlays, which resolve their
  // own presigned URL at render/request time, aren't affected by this.
  private async brandingFor(organizationId: string): Promise<EmailBranding | undefined> {
    const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!org) return undefined;

    return {
      organizationName: org.name,
      logoUrl: null,
      brandColor: org.brandColor,
      showPoweredBy: !FLAGS.WHITE_LABEL(org.plan),
    };
  }

  private async recipientsFor(organizationId: string, type: NotificationType) {
    // Billing/quota is Owner+Admin territory per §9.2's "Manage billing"
    // row; content-pipeline notifications reach everyone who can act on it.
    const roles: UserRole[] =
      type === 'PAYMENT_FAILED' || type === 'QUOTA_WARNING' || type === 'QUOTA_EXCEEDED'
        ? [UserRole.OWNER, UserRole.ADMIN]
        : [UserRole.OWNER, UserRole.ADMIN, UserRole.EDITOR];

    return this.prisma.client.user.findMany({
      where: { organizationId, role: { in: roles } },
      select: { email: true },
    });
  }

  private buildContent(type: NotificationType, m: Record<string, unknown>): { title: string; body: string; actionUrl?: string } {
    switch (type) {
      case 'SHORTS_READY': {
        const count = Number(m.count ?? 0);
        return {
          title: `${count} Short${count === 1 ? '' : 's'} ready for review`,
          body: `${count} Short${count === 1 ? ' is' : 's are'} waiting in your review queue.`,
          actionUrl: '/shorts',
        };
      }
      case 'SHORT_PUBLISHED':
        return {
          title: `"${m.title}" is live`,
          body: `Published to YouTube: youtube.com/watch?v=${m.youtubeVideoId}`,
          actionUrl: '/scheduler',
        };
      case 'PIPELINE_FAILURE':
        return {
          title: `Pipeline failure on ${m.resourceType === 'schedule' ? 'a scheduled publish' : 'a video import'}`,
          body: String(m.reason ?? 'Unknown error — check the runbook (§20.8) or worker logs.'),
          actionUrl: m.resourceType === 'schedule' ? '/scheduler' : `/videos/${m.resourceId}`,
        };
      case 'QUOTA_WARNING':
        return {
          title: `You've used ${m.pct}% of this month's Shorts quota`,
          body: `${m.used} of ${m.quota} Shorts published this billing period. Upgrade to avoid interruptions.`,
          actionUrl: '/billing',
        };
      case 'QUOTA_EXCEEDED':
        return {
          title: 'Monthly Shorts quota reached',
          body: 'New publishes are blocked until you upgrade or the billing period resets.',
          actionUrl: '/billing',
        };
      case 'PAYMENT_FAILED':
        return {
          title: 'Payment failed',
          body: `We couldn't process your latest invoice (${m.invoiceId}). Update your card to avoid a plan downgrade.`,
          actionUrl: '/billing',
        };
      case 'WEEKLY_DIGEST':
        return {
          title: 'Your week on Shorts Pilot',
          body: `${m.shortsPublished} Short${m.shortsPublished === 1 ? '' : 's'} published, ${m.totalViews} views` +
            (m.topShortTitle ? `. Top performer: "${m.topShortTitle}".` : '.'),
          actionUrl: '/analytics',
        };
      default:
        return { title: 'Notification', body: '' };
    }
  }
}
