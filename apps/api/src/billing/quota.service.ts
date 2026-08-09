import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { startOfMonth } from 'date-fns';
import { EventType, Plan } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// Agency+ are "Unlimited Shorts/mo" per §13.1 — never gated regardless of
// whatever numeric quotaShortsPerMonth happens to be stored on the org.
const UNLIMITED_PLANS: Plan[] = [Plan.AGENCY, Plan.ENTERPRISE];

@Injectable()
export class QuotaService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  // §13.2 checkAndConsumeQuota, split in two:
  //   - assertQuotaAvailable() is the READ-ONLY guard, called from
  //     SchedulesService.create() before a Short is committed to a
  //     publish schedule.
  //   - actual consumption already happens as a side effect of
  //     SchedulesService.markPublished()'s existing
  //     UsageEvent(SHORT_PUBLISHED) write — we deliberately don't
  //     double-count usage here. A Short that's scheduled but never
  //     actually publishes (cancelled, failed) never consumes quota.
  //
  // §18.2 critical test case: 51st Short on Starter plan -> 402
  // QUOTA_EXCEEDED; Short stays APPROVED, not PUBLISHED. Throwing here,
  // before SchedulesService.create() writes the Schedule row, is what
  // guarantees that.
  async assertQuotaAvailable(organizationId: string): Promise<void> {
    const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!org) return; // caller (SchedulesService) already 404s on a missing org upstream

    if (UNLIMITED_PLANS.includes(org.plan)) return;

    const used = await this.prisma.client.usageEvent.count({
      where: {
        organizationId,
        eventType: EventType.SHORT_PUBLISHED,
        createdAt: { gte: startOfMonth(new Date()) },
      },
    });

    if (used >= org.quotaShortsPerMonth) {
      // §15.1 "Quota exceeded" — Email + In-app, publishes blocked until
      // upgrade/next period. Fired here (not just left as a silent 402)
      // so the org owner finds out even if nobody is watching the UI.
      await this.notifications
        .notify('QUOTA_EXCEEDED', organizationId, { used, quota: org.quotaShortsPerMonth })
        .catch(() => undefined); // never let a notification failure mask the real 402 below

      throw new HttpException(
        {
          code: 'QUOTA_EXCEEDED',
          message: `Monthly Shorts limit reached (${org.quotaShortsPerMonth}/mo on the ${org.plan} plan).`,
          upgradeUrl: '/billing',
        },
        HttpStatus.PAYMENT_REQUIRED, // 402, per §13.2
      );
    }
  }

  // §15.1 "Quota warning 80%" — called from SchedulesService.markPublished()
  // right after the UsageEvent(SHORT_PUBLISHED) write, so `used` here
  // reflects the count including the Short that was just published.
  //
  // Fires at most one notification per call, for the highest threshold this
  // particular publish just crossed — comparing (used-1)/quota against
  // used/quota means a single Short can't trigger both 80% and 95% at once,
  // and an org that's already past 95% before this publish won't re-fire on
  // every subsequent publish (pctBefore is already >= threshold).
  async checkAndNotifyThreshold(organizationId: string): Promise<void> {
    const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!org || UNLIMITED_PLANS.includes(org.plan) || org.quotaShortsPerMonth <= 0) return;

    const used = await this.prisma.client.usageEvent.count({
      where: {
        organizationId,
        eventType: EventType.SHORT_PUBLISHED,
        createdAt: { gte: startOfMonth(new Date()) },
      },
    });

    const pctNow = (used / org.quotaShortsPerMonth) * 100;
    const pctBefore = ((used - 1) / org.quotaShortsPerMonth) * 100;

    for (const threshold of [95, 80]) {
      if (pctBefore < threshold && pctNow >= threshold) {
        await this.notifications.notify('QUOTA_WARNING', organizationId, {
          pct: threshold,
          used,
          quota: org.quotaShortsPerMonth,
        });
        break;
      }
    }
  }

  // Backs GET /billing/usage — powers the /billing quota bar (§11.6).
  async usageThisMonth(organizationId: string) {
    const org = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const used = await this.prisma.client.usageEvent.count({
      where: {
        organizationId,
        eventType: EventType.SHORT_PUBLISHED,
        createdAt: { gte: startOfMonth(new Date()) },
      },
    });

    return {
      plan: org.plan,
      used,
      quota: org.quotaShortsPerMonth,
      unlimited: UNLIMITED_PLANS.includes(org.plan),
    };
  }
}
