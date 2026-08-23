# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects the **Security Hardening milestone** (§19.1, PR 9):
on top of team management, the platform now keeps an immutable audit trail
of every destructive action, rate-limits internal worker callbacks and the
Stripe webhook separately from user traffic, and has regression tests that
lock in the tenant-isolation guarantee so it can't silently regress.

> Paste URL → DB row → job dispatched → video downloaded & audio extracted →
> transcribed with word timestamps → GPT-4o scores candidate clips → human
> approves one → render-worker crops/captions/encodes it → "Shorts ready"
> notification (batched, max 1/hour) → human approves → quota check
> (§13.2) → schedule → publish-worker uploads it to YouTube at the
> scheduled time → "Short published" notification (in-app + Slack) →
> 24h later, and every day after via a 3am UTC cron, real view/watch-time/
> engagement data flows back from the YouTube Analytics API into the
> dashboard → a Stripe subscription determines the org's plan and monthly
> quota → at 80%/95% of that quota, or if a payment fails, or if any
> pipeline stage fails outright, the org owner gets an email (and a bell
> icon in the app) instead of silence → admins invite teammates, change
> roles, and deactivate accounts from `/settings/users` → **and every one
> of those destructive actions — disconnecting a channel, rejecting a
> clip or Short, cancelling a schedule, changing someone's role,
> deactivating a user, revoking an invite, updating org branding — is now
> appended immutably to the `AuditLog` table, so "who did this and when"
> is always answerable.**

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, 16 tables incl. `Notification`, `Invitation`) | ✅ |
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
| `apps/api` — `NotificationsModule` — email (Resend HTTP adapter) + in-app + Slack, routed per §15.1's channel matrix | ✅ |
| `apps/api` — `InvitationsModule` — hashed 48h-expiry invite tokens, invite/accept flow | ✅ |
| `apps/api` — `UsersService` — team roster, role changes, deactivate/reactivate, last-owner guard | ✅ |
| `apps/web` — `/settings/users` + `/invite/[token]` — team management + public accept page | ✅ |
| `apps/api` — **`AuditLogModule` (`AuditLogService`)** — global, append-only writer for the `AuditLog` table that has existed in the schema since the very first migration but was never actually written to | ✅ **new** |
| `apps/api` — **Wired into every destructive action**: `channel.disconnect`, `clip.reject`, `short.reject`, `schedule.cancel`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `invitation.revoked`, `organization.branding_updated` | ✅ **new** |
| `apps/api` — **Named throttle buckets** (`default` 100/min, `internal` 300/min, `webhook` 30/min) — worker callbacks (`/videos/:id/status`, `/videos/:id/clips`, `/shorts`, `/schedules/:id/complete`\|`/failed`\|`/quota-exceeded`) and the Stripe webhook now rate-limit separately from user-facing traffic | ✅ **new** |
| `apps/api` — **`InternalSecretGuard` hardened**: fails closed if `API_INTERNAL_SECRET` is unset, uses `crypto.timingSafeEqual` instead of `!==` to avoid leaking timing information to a brute-force attempt | ✅ **new** |
| `apps/api` — **Tenant-isolation regression test suite** (`test/tenant-isolation.test.js`) — asserts Org B cannot read/mutate Org A's channels, clips, shorts, schedules, or analytics via direct ID (§18.2's critical test case) | ✅ **new** |
| Full OWASP-ZAP / manual pen-test pass | ⏳ not started (see "Known follow-ups") |

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker, and a Stripe account
(test mode is fine). Email delivery is optional in dev — see the
Notifications section of prior release notes.

```bash
# 1. Install JS deps — no new packages this phase (AuditLogService only
#    uses the existing PrismaService; no new dependency)
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
# Fill in: ENCRYPTION_KEY, YouTube OAuth, OPENAI_API_KEY, S3/R2, Stripe,
# API_INTERNAL_SECRET (shared with every worker's .env — this is what
# InternalSecretGuard now fails closed without, so don't leave it blank).

# 4. Migrate + seed DB — NO new migration this phase. AuditLog has existed
#    since the very first migration; this PR only adds application code
#    that writes to it.
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev
pnpm --filter @shorts/db seed

# 5. Forward Stripe webhook events to your local API (separate terminal,
#    only needed if you're also testing billing)
stripe listen --forward-to localhost:3001/api/v1/billing/webhook

# 6. Start API + web
pnpm dev
```

## Seeing the audit trail

No special setup is required — every destructive action already goes
through the normal UI:

1. Disconnect a channel from `/settings` → `channel.disconnect`.
2. Reject a clip on `/videos/:id`, or a Short on `/shorts` → `clip.reject`
   / `short.reject`.
3. Cancel a pending schedule from `/scheduler` → `schedule.cancel`.
4. Change someone's role, deactivate/reactivate them, or revoke a pending
   invite from `/settings/users` → `user.role_changed` / `user.deactivated`
   / `user.reactivated` / `invitation.revoked`.
5. Update the org's Slack webhook URL via `PUT /organizations/branding` →
   `organization.branding_updated`.

There's no admin UI for the audit log yet (see "Known follow-ups") — inspect
rows directly via `pnpm --filter @shorts/db studio` and open the `AuditLog`
table, or query it in `psql`:

```sql
SELECT "action", "userId", "resourceType", "resourceId", "metadata", "createdAt"
FROM "AuditLog"
WHERE "organizationId" = '<your org id>'
ORDER BY "createdAt" DESC
LIMIT 20;
```

## Verifying the rate limits

- **Worker callbacks** (`internal` bucket, 300/min): any burst of
  `PATCH /videos/:id/status` calls under 300/min from clip-worker,
  transcription-worker, etc. is unaffected. Push past that in a load test
  and you'll get `429 Too Many Requests` — this is deliberately generous
  so normal pipeline bursts never trip it.
- **Stripe webhook** (`webhook` bucket, 30/min): `stripe trigger` events in
  local dev are nowhere near this limit; it exists as defense in depth on
  top of `Stripe-Signature` verification, not as the primary control.
- **Everything else** stays on the pre-existing `default` bucket (100/min).

## Why these specific choices

**`AuditLogService.record()` never catches its own errors.** Every other
best-effort side channel in this codebase (`NotificationsService.notify()`,
Slack posts) is wrapped in try/catch at the call site so a delivery failure
never blocks the state transition it's describing. Audit logging is
different: a notification that silently fails to send is a UX gap, but an
audit entry that silently fails to write is a compliance gap. If
`auditLog.record()` throws, the caller — and therefore the HTTP response —
sees it, rather than the operation appearing to succeed with no trace it
ever happened.

**`AuditLogModule` is `@Global()`.** The alternative was importing it into
eight different feature modules (`ChannelsModule`, `ClipsModule`,
`ShortsModule`, `SchedulesModule`, `OrganizationsModule`,
`InvitationsModule`, ...) for a single shared, stateless service with no
per-module configuration. `StorageModule` and `CryptoModule` already use
this pattern for the same reason.

**Three named throttle buckets instead of one flat limit.** A single
100/min ceiling shared between user clicks and worker callbacks meant a
legitimate burst of five parallel video imports — each firing several
`PATCH /videos/:id/status` calls as it moves through PENDING →
DOWNLOADING → DOWNLOADED → TRANSCRIBING → READY — could plausibly trip
the same limit protecting the login form. Splitting `internal` (generous,
worker-only) from `default` (user-facing) and `webhook` (Stripe-only,
tight) lets each traffic shape have an appropriate ceiling without loosening
protection on the routes that actually need it tight.

**`InternalSecretGuard` now uses `crypto.timingSafeEqual` and fails closed
on a missing secret.** The original `provided !== process.env.X` comparison
is a real (if narrow) timing side-channel on a route that's `@Public()` to
the JWT guard by design — worth closing given how cheap the fix is. Failing
closed when `API_INTERNAL_SECRET` isn't configured turns a silent
misconfiguration (every worker callback quietly rejected, or worse,
accepted) into an explicit, loud `UnauthorizedException` instead.

**Tenant-isolation tests assert the *absence* of cross-org access, not just
the presence of scoping code.** §18.2's critical test case has been true in
this codebase since day one because every service already calls
`findFirst({ where: { id, organizationId } })`, but nothing enforced that
staying true. `test/tenant-isolation.test.js` simulates Prisma's real
behavior (a tenant-scoped query returns `null` for a row that exists under
a different org) so that if a future PR ever "simplifies" one of these
queries back to `findFirst({ where: { id } })`, CI fails immediately
instead of the regression waiting for a real IDOR report.

## Known follow-ups

- **No admin UI for the audit log yet** — inspect via Prisma Studio or
  direct SQL (see above). A `/settings/audit-log` page with filtering by
  action/user/date is the natural next increment, not scoped into this PR.
- **`ipAddress` isn't captured on any `AuditLogEntry` yet** — every call
  site would need `@Req() req` threaded through to `req.ip`, which is
  mechanical but touches a lot of controllers. Flagged rather than done
  half-consistently across only some of the nine action types.
- **Billing actions (`checkout`, `portal`) aren't audit-logged** — they're
  financial but not destructive in the IDOR sense, and Stripe's own
  dashboard is already the audit trail for money movement.
- **No full OWASP-ZAP / manual pen-test pass yet** — §18.1 calls this out
  as its own testing tier; this PR's regression tests cover the specific
  IDOR pattern the spec calls out by name, not a general security audit.
- **JWT freshness on deactivation** — unchanged from the prior phase: a
  deactivated user's existing access token stays valid until its natural
  15-minute expiry.
- **No ownership-transfer flow** — unchanged: `PATCH /organizations/users/:id`
  still refuses to grant `OWNER` on anyone else's behalf.
- **No delivery log for email/Slack** — unchanged.
- **No per-user notification preferences** — unchanged.
- **Grace-period downgrade** on subscription cancellation — unchanged,
  still hard-downgrades to Starter immediately.
- **Analytics API call volume at scale** — unchanged, still one call per
  Short per day.

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Agency white-label features** | Custom domain, full branding, child sub-organizations, agency dashboard, bulk CSV import (§15.2) — now that billing, quota, notifications, and audit logging can all actually distinguish and inform an Agency-plan org. | §15.2, Phase 6 |
| 2 | **Audit log admin UI** | `/settings/audit-log` — filterable table over the data this PR started writing; nobody can see the trail today without direct DB access. | §9.4 follow-up |
| 3 | **Analytics API batching** | Collapse per-Short daily calls into batched multi-video requests before Short volume makes the current approach costly. | §17 follow-up |

## PR 9 — Security Hardening (§9.4, §18.2, §19.1, Week 7)

Closes the top item the README has flagged as "Next up #1" since PR 7:
audit-log writes (the `AuditLog` table existed but nothing wrote to it),
IDOR regression tests on the domains added since the multi-tenant model
first shipped, and rate limits distinguishing worker/webhook traffic from
user traffic.

### What this ships

- **`AuditLogModule` / `AuditLogService`** — global, append-only writer.
  Nine destructive actions across seven services now call
  `auditLog.record(...)` immediately after their state-changing write:
  `channel.disconnect`, `clip.reject`, `short.reject`, `schedule.cancel`,
  `user.role_changed`, `user.deactivated`, `user.reactivated`,
  `invitation.revoked`, `organization.branding_updated`.
- **Named throttle buckets** (`default`/`internal`/`webhook`) registered in
  `ThrottlerModule.forRoot(...)`, applied per-route via
  `@Throttle({ internal: {...} })` on every worker-callback route and
  `@Throttle({ webhook: {...} })` on the Stripe webhook.
- **`InternalSecretGuard` hardened** — fails closed on an unset
  `API_INTERNAL_SECRET`, compares with `crypto.timingSafeEqual` instead of
  `!==`.
- **`test/tenant-isolation.test.js`** — new regression suite asserting Org
  B cannot read or mutate Org A's channels/clips/shorts/schedules/analytics
  via direct ID, across every service touched by this PR plus the
  pre-existing ones.
- **No schema migration** — `AuditLog` has existed since
  `20260622165401_init`; this PR is pure application code.

### Deliberately deferred (see README "Known follow-ups")

- Audit log admin UI, `ipAddress` capture, billing action logging, and the
  full pen-test pass are explicitly out of scope — each is either a
  separate UI surface or a manual testing exercise that doesn't belong
  bundled into this backend-hardening PR.

### Migration

None. This PR does not touch `packages/db/prisma/schema.prisma`.
