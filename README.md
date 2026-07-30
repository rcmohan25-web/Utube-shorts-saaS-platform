# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects the **Analytics Engine milestone** (§17, PR 5): on top
of the Day 14 full-publish loop, the platform now tracks how every published
Short actually performs on YouTube.

> Paste URL → DB row → job dispatched → video downloaded & audio extracted →
> transcribed with word timestamps → GPT-4o scores candidate clips → human
> approves one → render-worker crops/captions/encodes it → human approves +
> schedules it → publish-worker uploads it to YouTube at the scheduled time →
> **24h later, and every day after via a 3am UTC cron, real view/watch-time/
> engagement data flows back from the YouTube Analytics API into the
> dashboard.**

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, all 12 tables) | ✅ |
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
| `apps/api` — **Analytics domain** (`AnalyticsSyncProcessor`, `YoutubeAnalyticsService`, `GET /analytics/overview`, `GET /analytics/shorts/:id`) | ✅ **new** |
| `apps/api` — **Analytics daily sync cron (3am UTC)** + **24h-post-publish first-sync job** (§17.1) | ✅ **new** |
| `apps/web` — Settings, Videos, Shorts (schedule modal), `/scheduler` week calendar | ✅ |
| `apps/web` — **`/analytics` dashboard** (KPI cards, views-over-time chart, 7d/30d/90d presets, §11.5) | ✅ **new** |
| Stripe billing, quota enforcement wiring, RBAC invite UI, security hardening pass | ⏳ not started |

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker.

```bash
# 1. Install JS deps — now includes recharts for the analytics chart
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
# No new env vars for the analytics pipeline — it reuses the same YouTube
# OAuth credentials and the yt-analytics.readonly scope already requested
# in §14.1. If a channel was connected before that scope existed, reconnect
# it once from Settings so the token actually carries analytics access.

# 4. Migrate + seed DB — no new migration in this phase; AnalyticsDaily
#    already existed in the schema from the original design
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev --name init
pnpm --filter @shorts/db seed

# 5. Start API + web
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

The YouTube **Analytics** API has its own separate quota pool (distinct from
the Data API quota above) and is far more generous for read-only report
queries — it hasn't been a practical constraint in dev/testing. See "Known
follow-ups" below for the batching plan once Short volume grows.

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
   `AnalyticsSyncProcessor`, delayed **24 hours** (YouTube's own numbers
   aren't meaningful sooner than that).
2. From then on, a **daily cron at 3am UTC** re-syncs every `PUBLISHED` Short
   from the last 90 days, catching late corrections to view counts.
3. Visit `/analytics` in the browser — KPI cards (total views, watch time,
   avg view duration, subscribers gained) and a views-over-time chart
   populate from whatever `AnalyticsDaily` rows exist for your org.

For local testing without waiting 24h on a real video, see
`README_PR5.md`'s "Manual / end-to-end testing" section for how to promote a
delayed Bull Board job immediately, or seed rows directly via
`pnpm --filter @shorts/db studio`.

## Why these specific choices

See `/mnt/project` for full ADR rationale. New in this phase:

**`PublishProcessor` lives in `SchedulesModule`, not `QueueModule`.** Every
other BullMQ processor is a stateless HTTP dispatcher with no NestJS service
dependencies. `PublishProcessor` needs `YoutubeTokenService` and
`SchedulesService` — putting it in `QueueModule` would create a circular
import (`QueueModule → SchedulesService → SchedulesModule → @InjectQueue →
QueueModule`). It's registered in `SchedulesModule` instead; the `PUBLISH`
queue itself is still declared in `QueueModule` (which is `@Global()`), so
`@InjectQueue(PUBLISH)` still resolves correctly from `SchedulesModule`.

**`AnalyticsSyncProcessor` follows the exact same pattern, one level down.**
It needs `YoutubeTokenService` too, so it lives in `AnalyticsModule` rather
than `QueueModule`, for the identical circular-import reason. `SchedulesModule`
now imports `AnalyticsModule` (one-way — `AnalyticsModule` does not import
`SchedulesModule` back) so `SchedulesService.markPublished()` can call
`AnalyticsService.scheduleFirstSync()` directly.

**Analytics sync stays in NestJS/TypeScript — no new Python worker.** Every
existing Python service (§6 pipeline stages) exists because it needs real
compute: ffmpeg, Whisper, OpenCV. Analytics sync is a GET request to a REST
API and a database upsert — pure I/O, no compute. Standing up a fifth Python
service for that would be pure operational overhead for no benefit, so it's
a plain BullMQ processor in `apps/api`, matching `PublishProcessor`'s shape.

**Access tokens are never cached in BullMQ payloads.** A publish job can sit
delayed for hours (scheduled Shorts, retry backoff) — the same is true of
analytics-sync jobs, which are *always* delayed at least 24h.
`YoutubeTokenService.getValidAccessToken()` is called fresh at the moment
each processor's `process()` actually runs — never at job-creation time.

**Idempotency lives in NestJS, not in the Python worker(s).** Before ever
calling `publish-worker`, `PublishProcessor` checks `Short.youtubeVideoId`.
`AnalyticsSyncProcessor` follows the same philosophy at the data layer:
every write is an `upsert` keyed on `AnalyticsDaily`'s
`@@unique([shortId, date])`, so re-running the daily cron for a day that
already has data is a safe no-op, not a duplicate row. Job-level dedup uses
content-addressed BullMQ `jobId`s (`analytics-sync-first_{shortId}`,
`analytics-sync-daily_{shortId}_{date}`), so re-queuing the same sync twice
is also a no-op at the queue layer, before it even reaches the DB.

**Quota exceeded is a distinct code path, not a generic failure.** §14.4
requires postponing *every* pending schedule on the affected channel by
24h, not just retrying the one that failed. `publish-worker` distinguishes
`403 quotaExceeded` from other 403s by inspecting `error.errors[].reason`
in Google's response body, and routes to a separate callback endpoint
(`/schedules/:id/quota-exceeded`) so `SchedulesService` can run the cascade.

## Known follow-ups on the analytics pipeline

- **API call volume at scale.** The daily cron currently makes one YouTube
  Analytics API call per published Short per day. Fine through dev/MVP;
  before an org accumulates hundreds of published Shorts this should batch
  multiple video IDs into a single `filters=video==id1,id2,...` call instead
  of fanning out one job per Short. Flagged in
  `analytics.service.ts`'s cron docstring, not yet fixed.
- **`subscribersGained` double-counting.** Summed per-Short across a channel,
  which can overstate true channel-level subscriber growth if the same
  viewer action gets attributed to more than one recent video. A correct fix
  needs a channel-level daily sync in addition to the existing per-video one.
- **No notifications yet on analytics events.** §15's "Weekly digest" email
  (Shorts published, views, top performer) is a natural next step now that
  the underlying data exists — not part of this phase.

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Stripe billing + quota enforcement** | `checkAndConsumeQuota()` designed but not wired into the publish path. Can't charge anyone yet. | §13, Week 5 |
| 2 | **Notifications** | Email/Slack for "Shorts ready," "Published," "Pipeline failure," "Quota warning," and now "Weekly digest" (views/top performer, powered by the new analytics data). Right now `quota:warning` only fires over WebSocket — nobody sees it if they're not looking at the browser tab. | §15, Week 6 |
| 3 | **Security hardening** | Pen-test pass, IDOR tests on `/schedules` and `/analytics` (mirroring the existing Clips/Shorts tests), rate limits on the new worker callbacks. | §18.2, §19.1, Week 7 |
| 4 | **Analytics API batching** | Collapse per-Short daily calls into batched multi-video requests before Short volume makes the current approach costly. | §17 follow-up (see above) |

Stripe billing is next — it's the one that turns this from a working product
into a business that can actually charge someone.
