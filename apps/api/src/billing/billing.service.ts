import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { Plan, SubStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
// PR 7 (§15 Notifications): payment-failed alerts.
import { NotificationsService } from '../notifications/notifications.service';

// §13.1 plan -> quota mapping. AGENCY/ENTERPRISE quotas here are nominal —
// QuotaService treats those two plans as unconditionally unlimited, so the
// exact number never actually gates anything for them.
const PLAN_QUOTAS: Record<Plan, number> = {
  [Plan.STARTER]: 50,
  [Plan.CREATOR]: 500,
  [Plan.AGENCY]: 999_999,
  [Plan.ENTERPRISE]: 999_999,
};

// Self-serve checkout covers Starter/Creator/Agency. Enterprise is "Custom"
// per §13.1 — no self-serve price, sales-assisted only.
const SELF_SERVE_PLANS: Plan[] = [Plan.STARTER, Plan.CREATOR, Plan.AGENCY];

function priceIdForPlan(plan: Plan): string | undefined {
  switch (plan) {
    case Plan.STARTER:
      return process.env.STRIPE_PRICE_STARTER;
    case Plan.CREATOR:
      return process.env.STRIPE_PRICE_CREATOR;
    case Plan.AGENCY:
      return process.env.STRIPE_PRICE_AGENCY;
    default:
      return undefined;
  }
}

function planForPriceId(priceId: string): Plan | undefined {
  const map: Partial<Record<string, Plan>> = {
    [process.env.STRIPE_PRICE_STARTER ?? '']: Plan.STARTER,
    [process.env.STRIPE_PRICE_CREATOR ?? '']: Plan.CREATOR,
    [process.env.STRIPE_PRICE_AGENCY ?? '']: Plan.AGENCY,
  };
  return map[priceId];
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private client: Stripe | null = null;

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {}

  private getClient(): Stripe {
    if (this.client) return this.client;
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
    this.client = new Stripe(key, { apiVersion: '2026-07-29.dahlia' });
    return this.client;
  }

  // §8.2 POST /billing/checkout (OWNER). Creates (or reuses) a Stripe
  // Customer for the org, then a subscription-mode Checkout Session.
  async createCheckoutSession(organizationId: string, plan: Plan, userId: string): Promise<string> {
    if (!SELF_SERVE_PLANS.includes(plan)) {
      throw new BadRequestException('Enterprise is sales-assisted — contact us to set up a custom plan');
    }
    const priceId = priceIdForPlan(plan);
    if (!priceId) {
      throw new Error(`No Stripe price configured for plan ${plan} — check STRIPE_PRICE_* env vars`);
    }

    const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');

    const stripe = this.getClient();
    const customerId = org.stripeCustomerId ?? (await this.ensureStripeCustomer(org.id, org.name));

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontendUrl}/billing?checkout=success`,
      cancel_url: `${frontendUrl}/billing?checkout=cancelled`,
      // organizationId travels in metadata on BOTH the session and the
      // resulting subscription so the webhook handler never has to guess
      // which org a Stripe object belongs to.
      subscription_data: { metadata: { organizationId } },
      metadata: { organizationId, requestedByUserId: userId },
      allow_promotion_codes: true,
    });

    if (!session.url) throw new Error('Stripe did not return a Checkout Session URL');
    return session.url;
  }

  // §8.2 GET /billing/portal (OWNER). Requires an existing Stripe customer
  // — i.e. the org has been through Checkout at least once.
  async createPortalSession(organizationId: string): Promise<string> {
    const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException('Organization not found');
    if (!org.stripeCustomerId) {
      throw new BadRequestException('No billing account yet — subscribe to a plan first');
    }

    const stripe = this.getClient();
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const portal = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${frontendUrl}/billing`,
    });
    return portal.url;
  }

  private async ensureStripeCustomer(organizationId: string, orgName: string): Promise<string> {
    const stripe = this.getClient();
    const customer = await stripe.customers.create({
      name: orgName,
      metadata: { organizationId },
    });
    await this.prisma.client.organization.update({
      where: { id: organizationId },
      data: { stripeCustomerId: customer.id },
    });
    return customer.id;
  }

  // §9.4 / §19.1: validate Stripe-Signature BEFORE touching the DB, and
  // deduplicate on event.id so a Stripe retry (they retry aggressively on
  // non-2xx) can never double-process a subscription or double-charge a
  // downstream side effect. rawBody is required — see main.ts's
  // `rawBody: true` NestFactory option; JSON.parse-then-restringify would
  // change byte-for-byte content and break signature verification.
  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    const stripe = this.getClient();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET is not configured');

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      this.logger.warn({ msg: 'billing.webhook.bad_signature', reason: (err as Error).message });
      throw new BadRequestException('Invalid Stripe webhook signature');
    }

    // §20.6 idempotency pattern: check-before-process via a unique
    // constraint. A duplicate insert (race between two retries arriving
    // concurrently) throws P2002, which we treat as "already handled".
    try {
      await this.prisma.client.stripeWebhookEvent.create({
        data: { stripeEventId: event.id, type: event.type },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        this.logger.log({ msg: 'billing.webhook.duplicate_ignored', eventId: event.id, type: event.type });
        return;
      }
      throw err;
    }

    this.logger.log({ msg: 'billing.webhook.received', eventId: event.id, type: event.type });

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
        await this.onSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        await this.onSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      case 'invoice.payment_failed':
        await this.onPaymentFailed(event.data.object as Stripe.Invoice);
        break;
      default:
        this.logger.log({ msg: 'billing.webhook.unhandled_type', type: event.type });
    }
  }

  private async onCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const organizationId = session.metadata?.organizationId;
    if (!organizationId || !session.subscription) {
      this.logger.warn({ msg: 'billing.webhook.checkout_missing_metadata', sessionId: session.id });
      return;
    }

    const stripe = this.getClient();
    const subscriptionId =
      typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    await this.upsertSubscription(organizationId, subscription);
  }

  private async onSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const organizationId = subscription.metadata?.organizationId;
    if (!organizationId) {
      // Fall back to looking up by our own record — covers subscriptions
      // whose metadata predates this deploy.
      const existing = await this.prisma.client.subscription.findUnique({
        where: { stripeSubscriptionId: subscription.id },
      });
      if (!existing) {
        this.logger.warn({ msg: 'billing.webhook.subscription_no_org', subscriptionId: subscription.id });
        return;
      }
      await this.upsertSubscription(existing.organizationId, subscription);
      return;
    }
    await this.upsertSubscription(organizationId, subscription);
  }

  private async upsertSubscription(organizationId: string, subscription: Stripe.Subscription): Promise<void> {
    const priceId = subscription.items.data[0]?.price?.id;
    const plan = priceId ? planForPriceId(priceId) : undefined;
    if (!plan) {
      this.logger.error({
        msg: 'billing.webhook.unknown_price',
        subscriptionId: subscription.id,
        priceId,
      });
    }

    const status = mapStripeStatus(subscription.status);
    const firstItem = subscription.items.data[0];
    const currentPeriodStart = firstItem
      ? new Date(firstItem.current_period_start * 1000)
      : new Date(subscription.start_date * 1000);
    const currentPeriodEnd = firstItem
      ? new Date(firstItem.current_period_end * 1000)
      : new Date(subscription.start_date * 1000);

    await this.prisma.client.$transaction(async (tx) => {
      await tx.subscription.upsert({
        where: { stripeSubscriptionId: subscription.id },
        create: {
          organizationId,
          stripeSubscriptionId: subscription.id,
          plan: plan ?? Plan.STARTER,
          status,
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
        update: {
          plan: plan ?? undefined,
          status,
          currentPeriodStart,
          currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancel_at_period_end,
        },
      });

      // Only flip the org's active plan/quota while the subscription is in
      // a paying-and-current state. A PAST_DUE or CANCELLED subscription
      // should not silently upgrade a org's quota.
      if (plan && (status === SubStatus.ACTIVE || status === SubStatus.TRIALING)) {
        await tx.organization.update({
          where: { id: organizationId },
          data: { plan, quotaShortsPerMonth: PLAN_QUOTAS[plan] },
        });
      }
    });
  }

  private async onSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const existing = await this.prisma.client.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    if (!existing) return;

    await this.prisma.client.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { stripeSubscriptionId: subscription.id },
        data: { status: SubStatus.CANCELLED },
      });
      // Downgrade to Starter — matches §13.1's cheapest self-serve tier.
      // A hard downgrade (rather than leaving the old plan/quota in place)
      // is the safer default: it fails closed on quota, not open.
      await tx.organization.update({
        where: { id: existing.organizationId },
        data: { plan: Plan.STARTER, quotaShortsPerMonth: PLAN_QUOTAS[Plan.STARTER] },
      });
    });

    this.logger.log({ msg: 'billing.subscription_cancelled', organizationId: existing.organizationId });
  }

  private async onPaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscription = invoice.parent?.subscription_details?.subscription;
    if (!subscription) return;
    const subscriptionId = typeof subscription === 'string' ? subscription : subscription.id;

    const existing = await this.prisma.client.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!existing) return;

    await this.prisma.client.subscription.update({
      where: { stripeSubscriptionId: subscriptionId },
      data: { status: SubStatus.PAST_DUE },
    });

    // §15.1 "Payment failed: Email + In-app — Stripe payment_intent.payment_failed
    // webhook." Fire the actual notification now that the pipeline exists —
    // this used to be log-only.
    await this.notifications.notify('PAYMENT_FAILED', existing.organizationId, {
      invoiceId: invoice.id,
    });

    this.logger.error({
      msg: 'billing.payment_failed',
      organizationId: existing.organizationId,
      subscriptionId,
      invoiceId: invoice.id,
    });
  }
}

function mapStripeStatus(status: Stripe.Subscription.Status): SubStatus {
  switch (status) {
    case 'active':
      return SubStatus.ACTIVE;
    case 'trialing':
      return SubStatus.TRIALING;
    case 'past_due':
    case 'unpaid':
      return SubStatus.PAST_DUE;
    case 'canceled':
      return SubStatus.CANCELLED;
    default:
      return SubStatus.UNPAID;
  }
}
