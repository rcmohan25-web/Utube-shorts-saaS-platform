# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects five combined milestones shipped back to back:

- **PR 10 — Agency White-Label Features** (§15.2, Phase 6): client
  sub-organizations, an agency health/usage dashboard, org-scoped API
  keys with a minimal public REST API, CSV bulk import — all behind a
  real plan-gated feature-flag system (§20.7).
- **PR 11 — Audit Log Admin UI** (§9.4 follow-up): the compliance trail
  PR 9 started writing and PR 10 extended is now readable from the
  product — filterable, cursor-paginated.
- **PR 12 — Full White-Label Branding Pass** (§15.2): `Organization.logoS3Key`
  / `brandColor` have existed in the schema since the very first
  migration but nothing ever read them. This PR wires them into the app
  shell, every outbound email, and every newly rendered Short's
  caption/overlay — and hides "Powered by Shorts Pilot" everywhere once
  an org is Agency+.
- **PR 13 — Analytics API Call Batching** (§17 follow-up): the daily
  analytics-sync cron previously made one YouTube Analytics API call per
  published Short. It now groups Shorts by channel and batches them into
  YouTube's multi-video `filters=video==id1,id2,...` requests, cutting
  API call volume from O(Shorts) to O(Shorts / 40) per channel per day.
- **PR 14 — Per-API-Key Rate Limiting + Scoping** (§15.2 follow-up): the
  public API's `external` throttle bucket is now tracked per API key
  instead of per IP, and every API key carries a `READ_ONLY` /
  `READ_WRITE` scope — write routes reject read-only keys outright.

> Paste URL → DB row → job dispatched → video downloaded & audio
> extracted → transcribed with word timestamps → GPT-4o scores candidate
> clips → human approves one → render-worker crops/captions/encodes it
> with this org's own brand color burned into the captions and its logo
> overlaid in the corner → "Shorts ready" notification (sent from a
> branded email with this org's logo and color) → human approves →
> quota check (§13.2) → schedule → publish-worker uploads it to YouTube →
> "Short published" notification → daily analytics sync, now batched per
> channel instead of firing one YouTube API call per Short → Stripe
> subscription drives plan/quota → 80%/95% quota or payment-failure
> alerts → admins manage teammates from `/settings/users` → an
> Agency-plan org creates client sub-organizations from `/agency`, issues
> **scoped** API keys from `/settings/api-keys` (rate-limited per key,
> not per IP), bulk-imports a CSV of URLs, reviews `/settings/audit-log`
> — and any org, on any plan, can upload a logo and set a brand color
> from `/settings/branding`, with Agency+ orgs seeing "Powered by Shorts
> Pilot" disappear from the sidebar and every email footer.

## What's built

| Layer | Status |
| --- | --- |
| Monorepo, DB schema, auth, tenant isolation, RBAC | ✅ |
| Full pipeline (import → download → transcribe → clip-score → render → publish) | ✅ |
| WebSockets, Analytics + daily sync, Stripe billing + quota | ✅ |
| Notifications (email/in-app/Slack), team invites, `/settings/users` | ✅ |
| `AuditLogService.record()` wired into every destructive action | ✅ |
| Named throttle buckets, `InternalSecretGuard`, tenant-isolation regression suite | ✅ |
| `packages/shared/feature-flags.ts` (`FLAGS`) — plan-gated feature policy | ✅ PR 10 |
| `apps/api` — `FeatureGuard` / `@Feature(...)` | ✅ PR 10 |
| `apps/api` — `AgencyModule`, `ApiKeysModule`, `PublicApiModule`, CSV bulk import | ✅ PR 10 |
| `apps/web` — `/agency`, `/settings/api-keys` | ✅ PR 10 |
| `apps/api` — `AuditLogService.query()` cursor pagination + filters | ✅ PR 11 |
| `apps/api` — `AuditLogController` (`GET /audit-log`, `GET /audit-log/actions`) | ✅ PR 11 |
| `apps/web` — `/settings/audit-log` filter bar + paginated table | ✅ PR 11 |
| `apps/api` — `StorageService.getPresignedUploadUrl()` — direct-to-storage logo upload | ✅ PR 12 |
| `apps/api` — `OrganizationsService`: branding CRUD, `requestLogoUploadUrl()`, `getPublicBranding()` | ✅ PR 12 |
| `apps/api` — `EmailService` renders every outbound email with the sending org's logo/color | ✅ PR 12 |
| `services/render-worker` — `caption_generator.py` burns the org's `brandColor` into captions | ✅ PR 12 |
| `apps/web` — `useBranding()`, `<PoweredByFooter/>`, `/settings/branding` | ✅ PR 12 |
| `apps/api` — `YoutubeAnalyticsService.fetchDailyMetricsBatch()` — one call, many videos | ✅ PR 13 |
| `apps/api` — `AnalyticsSyncProcessor` handles both `sync` (single) and `batch-sync` (per-channel) jobs | ✅ PR 13 |
| `apps/api` — `AnalyticsService.dailySyncAllPublished()` groups by channel + chunks into 40-video batches | ✅ PR 13 |
| `packages/db` — `ApiKey.scope` (`READ_ONLY` / `READ_WRITE`), `ApiKeyScope` enum | ✅ PR 14 |
| `apps/api` — `ApiKeyThrottlerGuard` — per-API-key rate limiting (replaces per-IP for `sk_live_...` requests) | ✅ PR 14 |
| `apps/api` — `ApiKeyScopeGuard` + `@RequireScope()` — enforces read/write scope on the public API | ✅ PR 14 |
| `apps/web` — `/settings/api-keys` scope picker on create + scope badge in the list | ✅ PR 14 |
| Custom domain per client (`client.brand.com`) | ⏳ not started — DNS/Vercel infra, out of scope for app code |
| Branded PDF/CSV exports, branded onboarding emails beyond the invite email | ⏳ not started |
| Consolidated agency billing | ⏳ not started |
| Fine-grained (per-resource) API key permissions | ⏳ not started |
| Audit log CSV/JSON export, `ipAddress` capture, real-time updates | ⏳ not started |

## Run it locally

```bash
corepack enable && corepack prepare pnpm@9.7.0 --activate
pnpm install

docker compose -f infrastructure/docker/docker-compose.yml up -d

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
cp services/clip-worker/.env.example services/clip-worker/.env
cp services/transcription-worker/.env.example services/transcription-worker/.env
cp services/render-worker/.env.example services/render-worker/.env
cp services/publish-worker/.env.example services/publish-worker/.env
# No new env vars for PR 13 or PR 14.

pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev   # PR 14 adds one migration: ApiKeyScope + ApiKey.scope
pnpm --filter @shorts/db seed

stripe listen --forward-to localhost:3001/api/v1/billing/webhook   # only if testing billing

pnpm dev
```

For the exact copy/apply and test steps for each PR, see
**`SETUP_INSTRUCTIONS_PR13.md`** and **`SETUP_INSTRUCTIONS_PR14.md`** in
this package. Apply PR 13 before PR 14 if starting from an older
checkout — PR 14's file set assumes PR 13's analytics files are already
in place (they don't conflict, but PR 14 doesn't re-ship them).

## Why these specific choices (PR 13)

**Batches are grouped by channel, not by organization.** The YouTube
Analytics API call is authenticated with one channel owner's OAuth access
token (`YoutubeTokenService.getValidAccessToken(userId)`), and
`channel==MINE` in the request scopes results to that one channel. Two
Shorts on different channels — even in the same org — can never share a
request, so `channelId` is the grouping key, with `channel.userId`
carried alongside it as the token lookup.

**The 24h first-sync job stays per-Short, unbatched.**
`scheduleFirstSync()` fires once per publish, scattered across whatever
times Shorts happen to go live — there's no natural batch boundary to
group them into without adding a debounce window purely to shave a call
volume that was never the actual cost driver. The daily cron re-syncing
*every* published Short *every* day for 90 days was the O(Shorts) cost
this PR targets; first-sync is O(publishes), which is much smaller and
already spread out.

**`fetchDailyMetrics()` is now a thin wrapper around
`fetchDailyMetricsBatch()`**, not a separate implementation. There's
exactly one code path that talks to the YouTube Analytics API — a
single-video call is just a batch of size one — so there's no risk of the
two drifting the way two independently-maintained methods eventually
would.

**Batch size (40) lives in two places on purpose.**
`AnalyticsService.ANALYTICS_BATCH_SIZE` decides how big a BullMQ job to
build; `YoutubeAnalyticsService.MAX_BATCH_VIDEO_IDS` documents what a
single HTTP call is assumed safe to carry. They currently agree, but one
is a queueing decision and the other is an HTTP-payload decision — they're
allowed to diverge later without a hidden coupling.

**A batch job re-checks `PUBLISHED` status per-item at fire time**, the
same way the single-Short path always has. `processBatch()` filters out
any Short that was re-rendered or rejected in the interim before making
the API call.

## Why these specific choices (PR 14)

**The throttle tracker hashes the raw key instead of resolving it to an
`apiKeyId` via a DB call.** `ApiKeyThrottlerGuard` is registered as the
global `APP_GUARD`, and Nest always runs global guards before any
route-level `@UseGuards()` guard — including `ApiKeyGuard` on
`PublicApiController`. That means `req.apiKeyId` (set by `ApiKeyGuard`)
is never available yet when the throttler's tracker function runs. Rather
than fight guard ordering, the throttler guard independently parses the
`Authorization` header and hashes it — no DB lookup, no coupling to
`ApiKeyGuard`'s execution, and it still uniquely and stably identifies
the caller for rate-limiting purposes.

**Scope is a coarse two-tier enum (`READ_ONLY` / `READ_WRITE`), not
per-resource permissions.** The public API surface today is exactly one
write route (`POST /public/v1/videos`) and one read route
(`GET /public/v1/videos`, §15.2's original scope). A finer-grained model
would be speculative ahead of the API actually growing more resources.

**`ApiKeyScopeGuard` is a separate guard from `ApiKeyGuard`, not folded
into it.** `ApiKeyGuard`'s job is authentication (is this a valid,
non-revoked key?) and stays that way; `ApiKeyScopeGuard`'s job is
authorization (is this specific route allowed for this key's scope?).
Keeping them separate mirrors the existing `JwtAuthGuard` / `RolesGuard`
split (§9.2) rather than introducing a new pattern.

**A missing `scope` defaults to `READ_WRITE`, at both the schema level
(`@default(READ_WRITE)`) and the service level
(`dto.scope ?? ApiKeyScope.READ_WRITE`).** Every key created before this
PR could do everything the `API_ACCESS`-gated routes expose; defaulting
to `READ_WRITE` preserves that behavior for existing keys rather than
silently narrowing access under people's feet.

## Known follow-ups

- **Custom domain per client** (`client.brand.com` via CNAME) — DNS/Vercel
  infrastructure work, not application code.
- **Stable public logo URLs for email** — intentionally deferred; see the
  PR 12 section below for the rationale.
- **Branding on the invite email, weekly digest, and other pre-membership
  system mail** — `notifyTeamInvite()` still sends unbranded.
- **Consolidated agency billing** — child orgs bill independently.
- **Fine-grained (per-resource) API key scopes** — today's `READ_ONLY` /
  `READ_WRITE` split is deliberately coarse; revisit once the public API
  surface grows past its current one write + one read route.
- **No `ipAddress` on any audit entry yet.**
- **No audit log export** (CSV/JSON) of a filtered view.
- **No real-time audit log updates.**
- **First-sync jobs (§17.1, 24h-after-publish) remain per-Short** —
  batching candidate only if publish-event clustering becomes a real cost
  driver; not observed yet.
- **Batch size for analytics sync is a static constant (40), not
  adaptive** — no dynamic probing of YouTube's actual per-request limit.
- **Throttle limits are still flat per bucket, not tiered by plan** — a
  `READ_WRITE` key on a Starter org and one on an Agency org share the
  same 120/min `external` ceiling. Per-plan throttle tiers are a natural
  next step now that per-key tracking (PR 14) is in place to build on.

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Custom domains + stable public logo URLs** | Unblocks branded emails and is the last major piece of §15.2's white-label promise. | §15.2 |
| 2 | **Audit log export + `ipAddress` capture** | Compliance-adjacent gap flagged since PR 11; low effort, clear ask from anyone relying on `/settings/audit-log`. | §9.4 follow-up |
| 3 | **Per-plan throttle tiers for the public API** | Now that limits are tracked per key (PR 14), varying the ceiling by the owning org's plan is a natural next increment. | §15.2 follow-up |

---

## PR 10 — Agency White-Label Features (§15.2, Phase 6)

`packages/shared/src/feature-flags.ts` (`FLAGS`) + `FeatureGuard`;
`AgencyModule` (client sub-orgs + dashboard); `ApiKeysModule` +
`ApiKeyGuard` + `PublicApiModule`; `POST /videos/bulk-import`;
`Organization.parentOrganizationId` + `ApiKey` model.

To exercise Agency-gated features, bump the demo org:

```sql
UPDATE "Organization" SET plan = 'AGENCY', "quotaShortsPerMonth" = 999999
WHERE slug = 'demo-org';
```

Then log out and back in — plan is baked into the JWT at issue time
(§9.1), so a fresh access token is required for anything gated by
`FeatureGuard`.

## PR 11 — Audit Log Admin UI (§9.4 follow-up)

`AuditLogService.query()` (cursor pagination, filters) +
`AuditLogService.distinctActions()`; `AuditLogController`
(`@Roles(ADMIN, OWNER)`); `packages/shared/src/audit.ts`; `apps/web`
`/settings/audit-log`. No schema changes.

## PR 12 — Full White-Label Branding Pass (§15.2)

`StorageService.getPresignedUploadUrl()`; `OrganizationsService`
branding extensions; `GET/PUT /organizations/branding`,
`POST /organizations/branding/logo-upload-url`; branded `EmailService`
HTML wrapper; `NotificationsService.brandingFor()`;
`services/render-worker/caption_generator.py`'s hex→ASS brand-color
conversion; `packages/shared/src/branding.ts`; `apps/web`'s
`useBranding()`, `<PoweredByFooter/>`, `/settings/branding`. No schema
changes (`logoS3Key`/`brandColor` existed since §5.1).

## PR 13 — Analytics API Call Batching (§17 follow-up)

### What this ships

- `YoutubeAnalyticsService.fetchDailyMetricsBatch()` — one YouTube
  Analytics API call for up to `MAX_BATCH_VIDEO_IDS` (40) video IDs,
  using `dimensions=day,video` and `filters=video==id1,id2,...` so a
  single response carries every video's daily rows. Returns a
  `Map<youtubeVideoId, DailyMetrics[]>`.
- `YoutubeAnalyticsService.fetchDailyMetrics()` is now a one-line wrapper
  around the batch method — there is exactly one code path that talks to
  the YouTube Analytics API.
- `AnalyticsSyncProcessor` now branches on `job.name`:
  - `'sync'` → `processSingle()` — unchanged behavior, still what
    `scheduleFirstSync()` enqueues.
  - `'batch-sync'` (new) → `processBatch()` — re-verifies each Short is
    still `PUBLISHED`, makes one `fetchDailyMetricsBatch()` call for the
    whole batch, and upserts `AnalyticsDaily` rows per Short/day exactly
    as before.
- `AnalyticsService.dailySyncAllPublished()` now groups published Shorts
  by `channelId` (carrying the channel owner's `userId` for token
  lookup), chunks each channel's video list into batches of
  `ANALYTICS_BATCH_SIZE` (40), and enqueues one `'batch-sync'` job per
  chunk instead of one `'sync'` job per Short.
- `scheduleFirstSync()` is untouched — still enqueues a single `'sync'`
  job per publish, 24h delayed.
- `AnalyticsModule` and `AnalyticsController` are unchanged — no new
  providers, no new routes; batching is invisible to the read-side API.
- Tests: `apps/api/test/analytics-batch.test.js`.

### Migration

**None.** Pure application-code change; no Prisma schema changes.

## PR 14 — Per-API-Key Rate Limiting + Scoping (§15.2 follow-up)

### What this ships

- `ApiKeyScope` enum (`READ_ONLY`, `READ_WRITE`) and `ApiKey.scope`
  column, defaulting to `READ_WRITE` (expand-only migration, no
  backfill script needed).
- `CreateApiKeyDto` accepts an optional `scope`; `ApiKeysService.create()`
  defaults it to `READ_WRITE` when omitted, persists it, and includes it
  in the `apikey.created` audit-log metadata. `list()` now selects
  `scope`; `resolve()` returns the full record (including `scope`) for
  `ApiKeyGuard` to read.
- `ApiKeyGuard` now also attaches `req.apiKeyScope` from the resolved key.
- New `ApiKeyScopeGuard` + `@RequireScope(ApiKeyScope.X)` decorator:
  routes without the decorator are callable by any valid key; a
  `READ_WRITE` key satisfies any requirement; a `READ_ONLY` key is
  rejected with a `ForbiddenException` from any `@RequireScope(READ_WRITE)`
  route. Applied to `PublicApiController` (`ApiKeyGuard, ApiKeyScopeGuard`,
  in that order) with `@RequireScope(ApiKeyScope.READ_WRITE)` on
  `POST /public/v1/videos` only.
- New `ApiKeyThrottlerGuard extends ThrottlerGuard`, overriding
  `getTracker()` to hash a `Bearer sk_live_...` token into an
  `apikey:<sha256>` tracker string, falling back to the base class's
  IP-based tracking for every other request. Registered as the global
  `APP_GUARD` in `app.module.ts`, replacing the plain `ThrottlerGuard`.
- `apps/web` `/settings/api-keys`: scope picker on the create form,
  scope badge on the reveal-once card and on each listed key.
- Tests: `apps/api/test/api-keys.test.js` (extended with scope
  create/default/list/resolve coverage) and new
  `apps/api/test/api-key-scope.test.js` (`ApiKeyScopeGuard`'s allow/deny
  matrix, `ApiKeyGuard`'s attachment of `apiKeyScope`, and
  `ApiKeyThrottlerGuard`'s tracker hashing/fallback behavior).

### Migration

One expand-only migration: `ApiKeyScope` enum + `ApiKey.scope` column
with a `READ_WRITE` default. Safe to run while the app is live; no
backfill needed since the column default handles existing rows.
