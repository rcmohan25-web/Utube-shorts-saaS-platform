# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects the **Day 14 milestone** (§20.11): the full loop is
live — a pasted URL ends with a real, published YouTube video.

> Paste URL → DB row → job dispatched → video downloaded & audio extracted →
> transcribed with word timestamps → GPT-4o scores candidate clips → human
> approves one → render-worker crops/captions/encodes it → human approves +
> schedules it → publish-worker uploads it to YouTube at the scheduled time.

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, all 12 tables) | ✅ |
| `packages/shared` — cross-app types incl. `ShortPublishedEvent` | ✅ |
| `apps/api` — Auth (register/login/refresh-rotation/me) | ✅ |
| `apps/api` — Tenant isolation (`TenantInterceptor`, RBAC `RolesGuard`) | ✅ |
| `apps/api` — YouTube OAuth connect flow (§14.1) + Settings/Channels UI | ✅ |
| `apps/api` — BullMQ → HTTP dispatch processors (download, transcription, clip-detection, render, **publish**) | ✅ |
| `apps/api` — WebSocket gateway (`video:status`, `clip:created`, `short:ready`, **`short:published`, `quota:warning`**) | ✅ |
| `apps/api` — Clips + Shorts domains, S3 presigned URLs | ✅ |
| `apps/api` — **Schedules domain** (`POST /schedules`, cancel, calendar list) | ✅ |
| `apps/api` — **`YoutubeTokenService`** — lazy refresh at use-time + §14.2 pre-emptive cron | ✅ |
| `apps/api` — **Stuck-schedule cron** (§7.3) — catches publish-worker crashes | ✅ |
| `services/clip-worker` — yt-dlp, ffmpeg, PySceneDetect + GPT-4o clip scoring | ✅ |
| `services/transcription-worker` — Faster-Whisper, word timestamps | ✅ |
| `services/render-worker` — face crop, ASS captions, encode, thumbnail | ✅ |
| `services/publish-worker` — **YouTube resumable upload (§14.3), quota detection (§14.4)** | ✅ |
| `apps/web` — Settings, Videos, Shorts (now with schedule modal), **`/scheduler` week calendar** | ✅ |
| Analytics pipeline, Stripe billing, RBAC invite UI, security hardening pass | ⏳ not started |

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker.

```bash
# 1. Install JS deps
corepack enable && corepack prepare pnpm@9.7.0 --activate
pnpm install

# 2. Start infra — now includes publish-worker
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

# 4. Migrate + seed DB
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

**Access tokens are never cached in BullMQ payloads.** A publish job can sit
delayed for hours (scheduled Shorts, retry backoff). `YoutubeTokenService.getValidAccessToken()`
is called fresh at the moment `PublishProcessor.process()` actually runs —
never at job-creation time — with a 5-minute freshness guarantee that
comfortably covers even a slow multi-chunk upload.

**Idempotency lives in NestJS, not in the Python worker.** Before ever
calling `publish-worker`, `PublishProcessor` checks `Short.youtubeVideoId`.
If it's already set, a prior attempt uploaded successfully but the callback
was lost — we finalize without re-uploading. This is the same pattern as
§20.6's "Publish to YouTube" idempotency row in the spec.

**Quota exceeded is a distinct code path, not a generic failure.** §14.4
requires postponing *every* pending schedule on the affected channel by
24h, not just retrying the one that failed. `publish-worker` distinguishes
`403 quotaExceeded` from other 403s by inspecting `error.errors[].reason`
in Google's response body, and routes to a separate callback endpoint
(`/schedules/:id/quota-exceeded`) so `SchedulesService` can run the cascade.

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Analytics pipeline** | Daily sync cron, YouTube Analytics API, `/analytics` dashboard. No feedback loop yet on whether any of this drives views. | §17, Week 3 |
| 2 | **Stripe billing + quota enforcement** | `checkAndConsumeQuota()` designed but not wired into the publish path. Can't charge anyone yet. | §13, Week 5 |
| 3 | **Notifications** | Email/Slack for "Shorts ready," "Published," "Pipeline failure," "Quota warning." Right now `quota:warning` only fires over WebSocket — nobody sees it if they're not looking at the browser tab. | §15, Week 6 |
| 4 | **Security hardening** | Pen-test pass, IDOR tests on `/schedules` (mirroring the existing Clips/Shorts tests), rate limits on the new worker callbacks. | §18.2, §19.1, Week 7 |

Analytics is next — it's the one that proves the whole pipeline is worth running.
