# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects the **Billing & Quota Enforcement milestone** (§13,
PR 6): on top of the analytics loop, the platform can now actually charge
someone, and enforces plan quotas before a Short is ever scheduled.

> Paste URL → DB row → job dispatched → video downloaded & audio extracted →
> transcribed with word timestamps → GPT-4o scores candidate clips → human
> approves one → render-worker crops/captions/encodes it → human approves →
> **quota check (§13.2) → schedule → publish-worker uploads it to YouTube at
> the scheduled time** → 24h later, and every day after via a 3am UTC cron,
> real view/watch-time/engagement data flows back from the YouTube Analytics
> API into the dashboard → **and a Stripe subscription (Checkout,
> Portal, and a signature-verified webhook) is what actually determines the
> org's plan and monthly quota.**

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, 13 tables incl. `StripeWebhookEvent`) | ✅ |
| `packages/shared` — cross-app types incl. `ShortPublishedEvent` | ✅ |
| `apps/api` — Auth (register/login/refresh-rotation/me) | ✅ |
| `apps/api` — Tenant isolation (`TenantInterceptor`, RBAC `RolesGuard`) | ✅ |
| `apps/api` — YouTube OAuth connect flow (§14.1) + Settings/Channels UI | ✅ |
| `apps/api` — BullMQ → HTTP dispatch processors (download, transcription, clip-detection, render, publish) | ✅ |
| `apps/api` — WebSocket gateway (`video:status`, `clip:created`, `short:ready`, `short:published`, `quota:warning`) | ✅ |
| `apps/api` — Clips + Shorts domains, S3 presigned URLs | ✅ |
| `apps/api` — Schedules domain (`POST /schedules`, cancel, calendar list) | ✅ |
| `apps/api` — `YoutubeTokenService` — lazy refresh at use-time + §14.2 pre-emptive cron | ✅ |
| `apps/api` — Stuck-schedule cron (§7.3) — catches publish-worker crashes | ✅ |
| `services/clip-worker` — yt-dlp, ffmpeg, PySceneDetect + GPT-4o clip scoring | ✅ |
| `services/transcription-worker` — Faster-Whisper, word timestamps | ✅ |
| `services/render-worker` — face crop, ASS captions, encode, thumbnail | ✅ |
| `services/publish-worker` — YouTube resumable upload (§14.3), quota detection (§14.4) | ✅ |
| `apps/api` — Analytics domain (`AnalyticsSyncProcessor`, `YoutubeAnalyticsService`, `GET /analytics/overview`, `GET /analytics/shorts/:id`) | ✅ |
| `apps/api` — Analytics daily sync cron (3am UTC) + 24h-post-publish first-sync job (§17.1) | ✅ |
| `apps/web` — Settings, Videos, Shorts (schedule modal), `/scheduler` week calendar, `/analytics` dashboard | ✅ |
| `apps/api` — **`QuotaService`** — §13.2 `checkAndConsumeQuota`, wired into `SchedulesService.create()` (402 `QUOTA_EXCEEDED` before a Short can be scheduled) | ✅ **new** |
| `apps/api` — **`BillingService`** — Stripe Checkout (`POST /billing/checkout`), Customer Portal (`GET /billing/portal`), signature-verified + idempotent webhook (`POST /billing/webhook`) | ✅ **new** |
| `apps/api` — **`StripeWebhookEvent`** table — dedupes Stripe's at-least-once retries on `event.id` (§20.6 pattern) | ✅ **new** |
| `apps/web` — **`/billing` page** — plan comparison, live usage bar, Upgrade → Checkout, Manage billing → Portal (§11.6) | ✅ **new** |
| Notifications (email/Slack: ready, published, failure, quota warning, payment failed), RBAC invite UI, security hardening pass | ⏳ not started |

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker, and a Stripe account
(test mode is fine).

```bash
# 1. Install JS deps — now includes the `stripe` SDK on apps/api
corepack enable && corepack prepare pnpm@9.7.0 --activate
pnpm install

# 2. Start infra — clip-worker, transcription-worker, render-worker, publish-worker
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Configure env (all five: api, web, clip-worker, transcription-worker,
#    render-worker, publish-worker)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
cp services/clip-worker/.env.example services/clip-worker/.env
cp services/transcription-worker/.env.example services/transcription-worker/.env
cp services/render-worker/.env.example services/render-worker/.env
cp services/publish-worker/.env.example services/publish-worker/.env
# Fill in: ENCRYPTION_KEY, YouTube OAuth client id/secret, OPENAI_API_KEY,
# S3/R2 credentials. All *_WORKER_URL vars in apps/api/.env should already
# point at localhost — only change them if you move ports.
#
# NEW this phase — Stripe (apps/api/.env):
#   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, and one price ID per
#   self-serve plan: STRIPE_PRICE_STARTER, STRIPE_PRICE_CREATOR,
#   STRIPE_PRICE_AGENCY. Create three recurring Prices in the Stripe
#   Dashboard (test mode) matching §13.1's $29/$99/$299 tiers first.

# 4. Migrate + seed DB — this phase adds one new table (StripeWebhookEvent);
#    everything else (Subscription, UsageEvent, Organization.plan/
#    quotaShortsPerMonth/stripeCustomerId) already existed in the schema.
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev
pnpm --filter @shorts/db seed

# 5. Forward Stripe webhook events to your local API (separate terminal)
stripe listen --forward-to localhost:3001/api/v1/billing/webhook
# Copy the printed `whsec_...` into apps/api/.env as STRIPE_WEBHOOK_SECRET

# 6. Start API + web
pnpm dev
```

## ⚠️ Before testing real publishes: YouTube quota

Google's **default** YouTube Data API quota is 10,000 units/day.
`videos.insert` costs 1,600 units — **only ~6 uploads/day** until you request
an increase. Apply on Day 1 in Google Cloud Console (Console → APIs &
Services → YouTube Data API v3 → Quotas → Request increase to 100,000/day).
Standard approval for legitimate production apps, per §14.4.

If you hit the limit during testing, `publish-worker` detects the
`quotaExceeded` reason and calls `PATCH /schedules/:id/quota-exceeded`,
which postpones every pending schedule on that channel by 24h — check
`/scheduler` to see the postponed times, and the `quota:warning` WebSocket
event in the browser console.

This is a **YouTube API** quota, entirely separate from the **billing
quota** (Shorts/month per plan) described below.

## First end-to-end test (the Day 14 milestone)

1. Follow the Day 7–10 flow (see `PR-03-NOTES.md`) through to a Short sitting
   in `/shorts` review queue.
2. Click the Short → **Approve**. A schedule form appears in the same modal.
3. Pick a channel and a publish time at least 5 minutes out → **Confirm schedule**.
4. Go to `/scheduler`. The Short appears on the calendar at the chosen time,
   status `PENDING`.
5. Wait for the scheduled time (or pick "5 minutes from now" for a fast test).
   `PublishProcessor` fires, refreshes the OAuth token if needed, dispatches
   to `publish-worker`, which uploads the actual MP4 to YouTube.
6. The calendar entry flips to `PUBLISHED` live (WebSocket `short:published`),
   with a "View on YouTube →" link in the sidebar.

## Seeing real analytics data (the §17 milestone)

Once a Short is `PUBLISHED` (previous section), the analytics loop kicks in
automatically — no manual step required:

1. `SchedulesService.markPublished()` enqueues an `analytics-sync` job on the
   `AnalyticsSyncProcessor`, delayed **24 hours**.
2. From then on, a **daily cron at 3am UTC** re-syncs every `PUBLISHED` Short
   from the last 90 days, catching late corrections to view counts.
3. Visit `/analytics` in the browser — KPI cards and a views-over-time chart
   populate from whatever `AnalyticsDaily` rows exist for your org.

## Testing billing + quota enforcement (the §13 milestone, new this phase)

**Subscribing:**
1. Go to `/billing`. New orgs start on `STARTER` (seeded at registration,
   no Stripe customer yet).
2. Click **Upgrade** on any self-serve plan (Starter/Creator/Agency) →
   redirects to a real Stripe Checkout session. Use Stripe's test card
   `4242 4242 4242 4242`, any future expiry/CVC.
3. On success, Stripe redirects back to `/billing?checkout=success` and
   fires a `checkout.session.completed` webhook. `BillingService` creates
   the `Subscription` row and bumps `Organization.plan` +
   `quotaShortsPerMonth`. The usage bar on `/billing` re-polls a few
   seconds later to pick it up.
4. **Manage billing** opens the real Stripe Customer Portal (cancel,
   update card, view invoices) — requires having gone through Checkout at
   least once (a `stripeCustomerId` must exist on the org).

**Quota enforcement:**
1. On the `STARTER` plan (50 Shorts/mo), the 51st attempt to schedule a
   Short — `POST /schedules` — returns `402` with
   `{ error: { code: 'QUOTA_EXCEEDED', upgradeUrl: '/billing' } }`. The
   Short itself stays `APPROVED` (never touches `SCHEDULED`/`PUBLISHED`),
   per §18.2's critical test case — nothing is silently lost, it's just
   not schedulable until you upgrade or the month rolls over.
2. `AGENCY` and `ENTERPRISE` plans are never gated (unlimited, per §13.1)
   regardless of what numeric quota is stored.
3. Quota is **consumed** at actual publish time (the existing
   `UsageEvent(SHORT_PUBLISHED)` write inside `markPublished()`) — a
   schedule that's cancelled or fails never counts against the quota.

For local testing without waiting for a real 50-Short cycle, seed
`UsageEvent` rows directly via `pnpm --filter @shorts/db studio`, or call
`GET /billing/usage` to inspect the current count.

## Why these specific choices

See `/mnt/project` for full ADR rationale. New in this phase:

**The quota gate lives in `SchedulesService.create()`, not in
`PublishProcessor` or `publish-worker`.** §18.2 requires a Short to stay
`APPROVED` (not silently stuck mid-pipeline) when quota is exceeded. The
only place that guarantee holds is before the `Schedule` row — and
therefore the BullMQ `publish` job — is ever created. Gating later (e.g. at
dispatch time) would mean a user sees a schedule sitting on the calendar
that will never actually fire, with no clear signal why.

**Quota *consumption* is unchanged from the original design — still the
`UsageEvent(SHORT_PUBLISHED)` write in `markPublished()`.** `QuotaService`
only adds a read-only check beforehand; it doesn't touch the write path.
This means the quota gate and the quota-consuming event can never drift out
of sync with each other, since they share the same source of truth
(`UsageEvent` rows this month).

**`BillingModule` is imported by `SchedulesModule`, one-way, same shape as
`AnalyticsModule`.** Neither `BillingModule` nor `AnalyticsModule` import
`SchedulesModule` back, so there's no circular-import risk — consistent
with the precedent already set for `PublishProcessor` and
`AnalyticsSyncProcessor` living in their own domain modules rather than the
global `QueueModule`.

**The Stripe webhook uses Nest's `rawBody: true` option, not a hand-rolled
`express.raw()` route.** Stripe's signature check (`stripe.webhooks.
constructEvent()`) needs the *exact* bytes that were signed. Nest's global
JSON body parser would otherwise re-serialize the payload before
`BillingService` ever sees it, silently breaking verification in a way
that's easy to miss in dev (works fine until the byte-for-byte content
differs) and infuriating to debug in prod.

**Idempotency on the Stripe webhook mirrors the existing §20.6 pattern
(`AnalyticsDaily`'s `@@unique([shortId, date])`, BullMQ `jobId`s) rather
than introducing a new one.** `StripeWebhookEvent.stripeEventId` is
`@unique`; the insert is attempted *before* any processing, and a `P2002`
constraint violation (a genuine race between two concurrent retries, or a
plain retry after a 200 got lost) is treated as "already handled" and
short-circuits. Stripe retries aggressively on non-2xx responses, so this
isn't a hypothetical edge case.

**Downgrade-on-cancel is immediate, not deferred to `current_period_end`.**
On `customer.subscription.deleted`, the org drops straight to `STARTER`'s
quota. This fails closed (a canceled subscriber can't keep publishing at
their old tier's volume) rather than open. A softer grace-period downgrade
is a reasonable follow-up but needs its own expiry mechanism (cron or
lazy-check) and was left out of this phase's scope.

## Known follow-ups

- **Notifications** (§15) still don't exist. `BillingService.onPaymentFailed()`
  currently only logs — no email/Slack alert reaches the org owner. This is
  now the most load-bearing gap: a `PAST_DUE` subscription is silent until
  someone notices Shorts stopped scheduling.
- **Quota warning at 80%/95%** (§15.1's "Quota warning" notification type)
  isn't wired up — `QuotaService.usageThisMonth()` exposes the numbers the
  `/billing` page renders, but nothing proactively pushes a warning before
  the hard 402 at 100%.
- **Grace-period downgrade** on subscription cancellation (see above).
- **Analytics API call volume at scale** — still one YouTube Analytics API
  call per Short per day; batching via `filters=video==id1,id2,...` remains
  a follow-up, unchanged from the prior phase.
- **`subscribersGained` double-counting** — unchanged from the prior phase;
  needs a channel-level daily sync alongside the per-video one.

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Notifications** | Email/Slack for "Shorts ready," "Published," "Pipeline failure," "Quota warning" (80%/95%, now that real usage numbers exist), "Payment failed" (now that real subscriptions exist), and "Weekly digest." `quota:warning` currently only fires over WebSocket — nobody sees it if they're not looking at the browser tab, and a failed card charge is currently silent. | §15, Week 6 |
| 2 | **RBAC invite UI + team management** | `/organizations/users/invite` endpoint and RBAC matrix (§9.2) exist and are enforced, but there's no `/settings/users` page yet to actually invite teammates or change roles. Needed before a real multi-seat customer (Creator: 5 seats, Agency: 25 seats) can onboard their team. | §9.2, §11.6, Week 4 |
| 3 | **Security hardening** | Pen-test pass, IDOR tests on `/schedules`, `/analytics`, and now `/billing` (mirroring the existing Clips/Shorts tenant-isolation tests), rate limits on worker callbacks and the Stripe webhook route specifically. | §18.2, §19.1, Week 7 |
| 4 | **Agency white-label features** | Custom domain, full branding, child sub-organizations, agency dashboard, bulk CSV import (§15.2) — now that billing can actually distinguish an Agency-plan org from a Starter one. | §15.2, Phase 6 |
| 5 | **Analytics API batching** | Collapse per-Short daily calls into batched multi-video requests before Short volume makes the current approach costly. | §17 follow-up |

Notifications are next — right now a `PAST_DUE` subscription or a stuck
pipeline fails silently unless someone happens to be staring at the
dashboard, and that's not a place a real SaaS product can stay for long.
