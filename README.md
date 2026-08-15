# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects the **Notifications milestone** (§15, PR 7): on top
of billing and quota enforcement, the platform now actually tells people
when something happens — a Short is ready, a publish succeeded or failed,
quota is running low, or a payment bounced — instead of requiring someone
to keep the dashboard open and watch for it.

> Paste URL → DB row → job dispatched → video downloaded & audio extracted →
> transcribed with word timestamps → GPT-4o scores candidate clips → human
> approves one → render-worker crops/captions/encodes it → **"Shorts ready"
> notification (batched, max 1/hour)** → human approves → quota check
> (§13.2) → schedule → publish-worker uploads it to YouTube at the
> scheduled time → **"Short published" notification (in-app + Slack)** →
> 24h later, and every day after via a 3am UTC cron, real view/watch-time/
> engagement data flows back from the YouTube Analytics API into the
> dashboard → a Stripe subscription determines the org's plan and monthly
> quota → **and at 80%/95% of that quota, or if a payment fails, or if any
> pipeline stage fails outright, the org owner gets an email (and a bell
> icon in the app) instead of silence.**

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, 14 tables incl. `Notification`) | ✅ |
| `packages/shared` — cross-app types incl. `NotificationEvent` | ✅ |
| `apps/api` — Auth (register/login/refresh-rotation/me) | ✅ |
| `apps/api` — Tenant isolation (`TenantInterceptor`, RBAC `RolesGuard`) | ✅ |
| `apps/api` — YouTube OAuth connect flow (§14.1) + Settings/Channels UI | ✅ |
| `apps/api` — BullMQ → HTTP dispatch processors (download, transcription, clip-detection, render, publish) | ✅ |
| `apps/api` — WebSocket gateway (`video:status`, `clip:created`, `short:ready`, `short:published`, `quota:warning`, `notification:new`) | ✅ |
| `apps/api` — Clips + Shorts domains, S3 presigned URLs | ✅ |
| `apps/api` — Schedules domain (`POST /schedules`, cancel, calendar list) | ✅ |
| `apps/api` — `YoutubeTokenService` — lazy refresh at use-time + §14.2 pre-emptive cron | ✅ |
| `apps/api` — Stuck-schedule cron (§7.3) — catches publish-worker crashes | ✅ |
| `services/clip-worker` — yt-dlp, ffmpeg, PySceneDetect + GPT-4o clip scoring | ✅ |
| `services/transcription-worker` — Faster-Whisper, word timestamps | ✅ |
| `services/render-worker` — face crop, ASS captions, encode, thumbnail | ✅ |
| `services/publish-worker` — YouTube resumable upload (§14.3), quota detection (§14.4) | ✅ |
| `apps/api` — Analytics domain + daily sync cron (3am UTC) + 24h-post-publish first-sync job (§17.1) | ✅ |
| `apps/api` — `QuotaService` (§13.2), Stripe `BillingService` (Checkout, Portal, signature-verified webhook) | ✅ |
| `apps/web` — Settings, Videos, Shorts, `/scheduler`, `/analytics`, `/billing` | ✅ |
| `apps/api` — **`NotificationsModule`** — email (Resend HTTP adapter, no SDK dep) + in-app (`Notification` table) + Slack (`Organization.webhookUrl`), routed per §15.1's channel matrix | ✅ **new** |
| `apps/api` — **Batched "Shorts ready" email** — debounced via a delayed BullMQ job keyed on `organizationId` (jobId dedupe = free coalescing), default 15-min window, configurable via `NOTIFICATIONS_BATCH_WINDOW_MS` | ✅ **new** |
| `apps/api` — **Wired into every §15.1 trigger**: pipeline failure (video import + render + publish), Short published, quota warning 80%/95%, quota exceeded, payment failed, weekly digest cron (Mondays 9am) | ✅ **new** |
| `apps/api` — Fixed `BillingModule` — it referenced `NotificationsService` since PR 6 but never imported `NotificationsModule`, so the app could not actually boot until this PR | ✅ **fixed** |
| `apps/web` — **Notification bell** — live badge via `notification:new` WebSocket event, mark-as-read, mounted in the app shell sidebar | ✅ **new** |
| `apps/api` — **`InvitationsModule`** — hashed 48h-expiry invite tokens, `POST /organizations/users/invite`, public `GET/POST /invitations/:token/*` accept flow, wired into the existing `NotificationsService.notifyTeamInvite()` (previously unused) | ✅ **new** |
| `apps/api` — **`UsersService`** — team roster, role changes, deactivate/reactivate, last-owner guard so a workspace can never lose its final Owner | ✅ **new** |
| `packages/db` — **`User.status`** (`ACTIVE`/`DEACTIVATED`) + **`Invitation`** table/enum, expand-only migration | ✅ **new** |
| `apps/web` — **`/settings/users`** — team table, invite form, role dropdown, deactivate/reactivate, pending-invite list with revoke | ✅ **new** |
| `apps/web` — **`/invite/[token]`** — public accept-invite page (preview + set name/password → logged in) | ✅ **new** |
| Security hardening pass | ⏳ not started |

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker, and a Stripe account
(test mode is fine). Email delivery is optional in dev — see below.

```bash
# 1. Install JS deps — no new packages this phase (EmailService/SlackService
#    use plain fetch, not a vendor SDK)
corepack enable && corepack prepare pnpm@9.7.0 --activate
pnpm install

# 2. Start infra — clip-worker, transcription-worker, render-worker, publish-worker
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Configure env (all six: api, web, clip-worker, transcription-worker,
#    render-worker, publish-worker)
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
cp services/clip-worker/.env.example services/clip-worker/.env
cp services/transcription-worker/.env.example services/transcription-worker/.env
cp services/render-worker/.env.example services/render-worker/.env
cp services/publish-worker/.env.example services/publish-worker/.env
# Fill in: ENCRYPTION_KEY, YouTube OAuth, OPENAI_API_KEY, S3/R2, Stripe
# (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_*).
#
# NEW this phase — Notifications (apps/api/.env):
#   RESEND_API_KEY  — leave blank in dev; emails are logged to the API
#                      console instead of sent, so nothing blocks without
#                      a Resend account.
#   EMAIL_FROM       — sender address once you do configure Resend.
#   NOTIFICATIONS_BATCH_WINDOW_MS — debounce window for the batched
#                      "Shorts ready" email (default 15 min).
#   Slack delivery needs no new env var — it reuses the per-org
#   Organization.webhookUrl field (already in the schema; set it via a
#   future /settings UI or directly in Prisma Studio for now).

# 4. Migrate + seed DB — this phase adds one new table (Notification) plus
#    one new enum (NotificationType); everything else was already there.
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev
pnpm --filter @shorts/db seed

# 5. Forward Stripe webhook events to your local API (separate terminal,
#    only needed if you're also testing billing)
stripe listen --forward-to localhost:3001/api/v1/billing/webhook

# 6. Start API + web
pnpm dev
```

## Seeing notifications fire

No special setup is required beyond the steps above — every trigger below
is wired into an existing flow:

1. **Shorts ready** — approve a clip on `/videos/:id`; once render-worker
   finishes, a batch job is queued (§15.1: max 1 email/hour) and fires
   after `NOTIFICATIONS_BATCH_WINDOW_MS` (15 min by default — lower this
   env var temporarily if you want to see it faster in dev). The in-app
   bell updates immediately regardless, since in-app delivery isn't
   batched — only the email is.
2. **Short published** — schedule a Short (`/shorts` → Approve → pick a
   time ≥5 min out) and wait for `/scheduler` to flip it to `PUBLISHED`.
   Fires in-app + Slack (if `Organization.webhookUrl` is set) the moment
   `SchedulesService.markPublished()` runs.
3. **Pipeline failure** — any `VideoStatus.FAILED` transition, any
   `Short` created at `FAILED` by render-worker, or any `Schedule` marked
   `FAILED` (including the §7.3 stuck-schedule cron) fires this.
4. **Quota warning / exceeded** — publish Shorts until you cross 80%,
   95%, or 100% of `Organization.quotaShortsPerMonth`. For fast local
   testing without a real 40-Short cycle, lower `quotaShortsPerMonth` on
   your seeded org directly via `pnpm --filter @shorts/db studio`.
5. **Payment failed** — trigger Stripe's `invoice.payment_failed` test
   event via the Stripe CLI: `stripe trigger invoice.payment_failed`.
6. **Weekly digest** — runs Mondays 9am UTC for any org with analytics or
   published-Short activity in the trailing 7 days; skips silent orgs.

Check `GET /notifications` (or the bell icon) for the in-app feed, and the
API console for logged emails if `RESEND_API_KEY` is unset.

## Why these specific choices

**"Shorts ready" batching uses a delayed BullMQ job keyed on
`organizationId`, not a cron or an in-memory debounce.** A delayed job with
a fixed `jobId` (`shorts-ready_{organizationId}`) is naturally idempotent:
re-adding it while one is already pending is a no-op (same pattern as
every other job dispatch in this codebase — video-download, publish,
analytics-sync). This means N renders in a burst produce exactly one email
without any new coordination primitive, and it survives an API restart
(unlike an in-memory timer would).

**`NotificationBatchProcessor` re-counts REVIEW Shorts at fire time rather
than trusting a count captured when the job was queued.** Some of those
Shorts may have already been approved or rejected by the time the batch
window elapses; re-querying means the email always reflects the truth at
send time, and a zero-count batch is a silent no-op rather than a
misleading "0 Shorts ready" email.

**Every call site wraps `notifications.notify()` in try/catch and never
lets a notification failure block or roll back the action it's
describing.** A Resend outage must never prevent a Short from being marked
`PUBLISHED`, and a malformed Slack webhook must never block quota
enforcement. This mirrors the existing pattern in `SchedulesService` for
`analytics.scheduleFirstSync()` — notification delivery is best-effort
plumbing bolted onto an already-correct state transition, not part of the
transition's own correctness.

**`QuotaService.checkAndNotifyThreshold()` fires on the publish path
(`SchedulesService.markPublished()`), not on a polling cron.** It compares
`(used-1)/quota` against `used/quota` so exactly one notification fires
for the highest threshold a given publish just crossed — never both 80%
and 95% at once, and never a repeat once an org is already past a
threshold. This piggybacks on the same `UsageEvent` write that already
exists for quota *consumption*, so there's no new source of truth to keep
in sync.

**`BillingModule` now imports `NotificationsModule`.** `BillingService`
has depended on `NotificationsService` in its constructor since PR 6, but
`BillingModule` never actually imported the module that provides it — the
app could not boot. This PR is what makes that dependency real.

## Known follow-ups

- **JWT freshness on deactivation** — a deactivated user's existing access
  token stays valid until its natural 15-minute expiry; only new
  logins/refreshes are blocked. A revocation list would close this but
  isn't justified yet given the short TTL.
- **No ownership-transfer flow** — `PATCH /organizations/users/:id` refuses
  to grant OWNER on anyone else's behalf (403). Needed before an Owner can
  ever leave a workspace they founded.
- **No delivery log for email/Slack** — the `Notification` table is the
  in-app channel's source of truth only; there's no record of whether a
  given email actually sent successfully beyond the API logs.
- **No per-user notification preferences** — every eligible role gets
  every applicable email; there's no opt-out yet.
- **Grace-period downgrade** on subscription cancellation — unchanged
  from the prior phase, still hard-downgrades to Starter immediately.
- **Analytics API call volume at scale** — still one YouTube Analytics API
  call per Short per day; batching remains a follow-up.
- **`subscribersGained` double-counting** — unchanged; needs a
  channel-level daily sync alongside the per-video one.

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Security hardening** | Pen-test pass, IDOR tests on `/schedules`, `/analytics`, `/billing`, and the upcoming `/organizations/*` (mirroring the existing Clips/Shorts tenant-isolation tests), audit-log writes (the `AuditLog` table exists but nothing writes to it yet, despite §9.4 requiring it), rate limits on worker callbacks and the Stripe webhook route specifically. | §9.4, §18.2, §19.1, Week 7 |
| 2 | **Agency white-label features** | Custom domain, full branding, child sub-organizations, agency dashboard, bulk CSV import (§15.2) — now that billing, quota, and notifications can all actually distinguish and inform an Agency-plan org. | §15.2, Phase 6 |
| 3 | **Analytics API batching** | Collapse per-Short daily calls into batched multi-video requests before Short volume makes the current approach costly. | §17 follow-up |

## PR 8 — RBAC Invite UI + Team Management (§9.2, §11.6, Week 4)

Closes the gap the README has flagged as "Next up #1" since PR 6: RBAC and
`/organizations/users/invite` were enforced/documented but there was no way
to actually invite a teammate short of writing to Postgres directly.

## What this ships

- **Invitation flow**: Admin/Owner invites by email + role → hashed,
  48h-expiry token → email via the existing `NotificationsService.notifyTeamInvite()`
  (already existed, unused until now) → public accept page creates the
  account and logs the person straight in.
- **Team management**: `/settings/users` — role changes, deactivate/reactivate,
  pending-invite list with revoke.
- **`User.status`** (`ACTIVE` / `DEACTIVATED`) — login rejects deactivated
  users. Last-owner guard on both role-change-away-from-OWNER and
  deactivate, so a workspace can never end up with zero active Owners.
- Ownership transfer is explicitly out of scope for the role-change endpoint
  (it's a higher-stakes action than a role bump) — flagged with a clear
  403 rather than silently allowed.

## Deliberately deferred (see README "Next up" #2)

- **Audit log writes** — `AuditLog` table still isn't written to. This PR
  doesn't scope-creep into that; it's the next PR per the existing roadmap.
- **JWT freshness on deactivation** — a deactivated user's existing access
  token (15-min expiry) still works until it naturally expires; only new
  logins are blocked. Acceptable given the short TTL; noted as a known gap
  rather than solved with a token-revocation list this PR doesn't need.

## Migration

`20260809100000_add_invitations_and_user_status` — expand-only per §20.5:
new `InvitationStatus`/`UserStatus` enums, new nullable-default `User.status`
column, new `Invitation` table. Safe to run while the app is live.
