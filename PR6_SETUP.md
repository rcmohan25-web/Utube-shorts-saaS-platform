# PR 6 — Stripe Billing + Quota Enforcement (§13)

Implements the #1 item on the README's "Next up" list: wires
`checkAndConsumeQuota` into the real scheduling path, and adds Stripe
Checkout / Customer Portal / webhook endpoints.

## Files in this bundle

New:
- `apps/api/src/billing/billing.module.ts`
- `apps/api/src/billing/billing.controller.ts`
- `apps/api/src/billing/billing.service.ts`
- `apps/api/src/billing/quota.service.ts`
- `apps/api/src/billing/dto/create-checkout.dto.ts`
- `apps/web/app/(app)/billing/page.tsx`
- `packages/db/prisma/migrations/20260731090000_add_stripe_webhook_event/migration.sql`
- `apps/api/test/quota.test.js`, `apps/api/test/billing.webhook.test.js`

Modified (full drop-in replacements):
- `apps/api/src/schedules/schedules.service.ts` — quota gate added to
  `create()`, right before the Schedule row is written.
- `apps/api/src/schedules/schedules.module.ts` — imports `BillingModule`.
- `apps/api/src/app.module.ts` — registers `BillingModule`.
- `apps/api/src/main.ts` — `rawBody: true` so the Stripe signature check
  has the exact signed bytes.

Reference only (append manually, not a full-file replacement):
- `packages/db/prisma/schema-addition.prisma` → append the
  `StripeWebhookEvent` model to `packages/db/prisma/schema.prisma`.
- `apps/api/.env.example.additions` → append to `apps/api/.env.example`
  and `apps/api/.env`.

## Install steps

```bash
# 1. Add the Stripe SDK to the API
pnpm --filter @shorts/api add stripe

# 2. Append the new model to schema.prisma (see schema-addition.prisma),
#    then apply the migration included in this bundle
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev

# 3. Fill in Stripe env vars (see .env.example.additions) — secret key,
#    webhook signing secret (from `stripe listen` in dev), and the three
#    self-serve price IDs from the Stripe Dashboard

# 4. For local testing, forward Stripe events to the webhook route:
stripe listen --forward-to localhost:3001/api/v1/billing/webhook
```

## Why the quota gate lives in `SchedulesService.create()`

§18.2's critical test case is explicit: *"51st Short on Starter plan → 402
QUOTA_EXCEEDED; Short stays APPROVED not PUBLISHED."* That only holds if the
check runs **before** a Schedule row (and therefore an eventual publish) is
committed — not at publish time, when the upload may already be underway.
`QuotaService.assertQuotaAvailable()` is a pure read (counts
`UsageEvent(SHORT_PUBLISHED)` rows for the current month); actual
consumption is unchanged — it's still the existing `UsageEvent` write inside
`SchedulesService.markPublished()`'s transaction. That means a schedule that
gets cancelled or fails never consumes quota, which is the correct
semantics.

## Why `rawBody: true` instead of a manual `express.raw()` route

Stripe signs the exact request bytes. Nest's global `ValidationPipe`/body
parser would otherwise re-serialize JSON before `BillingService` ever sees
it, silently breaking `stripe.webhooks.constructEvent()`. Passing
`rawBody: true` to `NestFactory.create()` is the documented Nest-native way
to get `req.rawBody` on every route without hand-rolling middleware
ordering — simpler and less error-prone than carving out one route with
`express.raw()` ahead of the global JSON parser.

## What's intentionally still open

- **Notifications** (§15) aren't built yet — `onPaymentFailed()` in
  `billing.service.ts` currently only logs; wiring it to an email/Slack
  notification is Week 6 scope per the README, not part of this PR.
- **Enterprise** has no self-serve Checkout path by design (§13.1: "Custom"
  pricing, sales-assisted) — `BillingService.createCheckoutSession()`
  rejects it with a clear message.
- **Downgrade-on-cancel** hard-resets the org to Starter immediately on
  `customer.subscription.deleted`. A softer "stay on current plan until
  `current_period_end`" grace period is a reasonable follow-up but adds a
  second cron (or lazy-check-on-request) to expire it — out of scope here.
