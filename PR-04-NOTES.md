# PR 4 — Scheduler + publish-worker (§14.2–14.4, §7.3)

Fourth PR. This is the one that turns "Shorts render" into "Shorts get
published" — the Day 13–14 milestone. Closes out §14.2's token-refresh cron,
which has sat wired-but-unused (referenced in comments, never implemented)
since PR 1.

## What's in this PR

**Backend — new domain**
- `apps/api/src/schedules/` — `SchedulesService`, `SchedulesController`,
  `CreateScheduleDto`. User-facing: `POST /schedules`, `GET /schedules?from&to&channelId`,
  `DELETE /schedules/:id`. Internal (worker callbacks): `PATCH /schedules/:id/complete`,
  `.../failed`, `.../quota-exceeded`.
- `apps/api/src/youtube/youtube-token.service.ts` (new) — the §14.2 piece.
  Two entry points: `getValidAccessToken()` (lazy refresh, called at the
  moment of every publish attempt) and `refreshNearlyExpiredTokens()`
  (the `@Cron('*/55 * * * *')` safety net).
- `apps/api/src/queues/processors/publish.processor.ts` (new) — **lives in
  `SchedulesModule`, not `QueueModule`**. See the README's "Why these
  specific choices" section for the circular-import reasoning.
- `apps/api/src/websockets/video.gateway.ts` — gains `emitShortPublished()`
  and `emitQuotaWarning()`.
- `apps/api/src/app.module.ts` — adds `ScheduleModule.forRoot()`. **This is
  the one line that makes every `@Cron` decorator in the app actually run** —
  without it, `refreshNearlyExpiredTokens` and `checkStuckSchedules` compile
  fine and silently never fire.
- `apps/api/package.json` — adds `@nestjs/schedule`.
- `apps/api/.env.example` — adds `PUBLISH_WORKER_URL`.

**Python — publish-worker (new service)**
- `youtube_uploader.py` — the exact §14.3 three-step resumable upload
  (initiate session → PUT 10 MB chunks handling `308 Resume Incomplete` →
  set thumbnail). Also implements §14.4's quota detection: inspects
  `error.errors[].reason` on any 403 to distinguish `quotaExceeded` from
  other 403s (revoked token, suspended channel, etc.) and raises a distinct
  `QuotaExceededException`.
- `main.py` — FastAPI service. Downloads the Short + thumbnail from S3,
  calls the uploader, and reports back to NestJS via one of three PATCH
  endpoints depending on outcome. Callbacks retry up to 3× with exponential
  backoff in case NestJS is mid-deploy when the upload finishes.
- `s3_client.py`, `requirements.txt`, `Dockerfile`, `.env.example`, `README.md`.

**Frontend**
- `apps/web/app/(app)/shorts/page.tsx` — Approve no longer just flips status;
  it reveals an inline schedule form (channel + datetime picker) in the same
  modal, matching §13.3 step 6 ("Approve → schedule modal").
- `apps/web/app/(app)/scheduler/page.tsx` (new) — week calendar per §11.4.
  Click a day's entry → sidebar with thumbnail, status, YouTube link (once
  published), Cancel button (only shown for `PENDING`). Per-channel daily
  count badges as a lightweight version of §11.4's "upload limit indicator."
- `packages/shared/src/types.ts` — `ShortPublishedEvent` (already existed
  from earlier scaffolding, confirmed present, no changes needed beyond
  what's already in the type).

**Infra**
- `infrastructure/docker/docker-compose.yml` — adds `publish-worker`.
- Root `README.md` — status table, quota warning callout, Day 14 test steps.

## Correctness guarantees (read before reviewing the diff)

**G1 — no duplicate schedules.** `SchedulesService.create()` rejects if a
`PENDING` or `PUBLISHED` schedule already exists for the `shortId`.

**G2 — at-most-once YouTube upload.** `PublishProcessor` checks
`Short.youtubeVideoId` before every dispatch to `publish-worker`. If a
previous attempt's upload succeeded but its callback to NestJS was lost
(network blip, NestJS restart), the retry finds the video ID already set
and finalizes without re-uploading — no duplicate video on the channel.

**G3 — quota exhaustion cascades, not just the failing job.** On
`quotaExceeded`, `SchedulesService.postponeForQuota()` moves *every*
`PENDING` schedule on that channel forward by 24h in one pass, updating
both the DB row and the BullMQ job's delay (remove + re-add with the same
`jobId`).

**G4 — schedule rows are never orphaned.** If `publishQueue.add()` throws
after the `Schedule` row is created, `SchedulesService.create()` deletes the
row as compensation before re-throwing. If `publish-worker` crashes after
accepting a job (so BullMQ thinks it's complete but nothing ever calls
back), `checkStuckSchedules()` (`@Cron('*/10 * * * *')`) marks any
`PENDING` schedule more than 30 minutes past its `scheduledAt` as `FAILED`.

**G5 — every transition is logged with full context.** `orgId`,
`scheduleId`, `shortId`, and timing are in every log line in
`SchedulesService`, matching the §20.3 structured-logging requirement.

## Design decisions worth flagging

**Why `PublishProcessor` isn't in `QueueModule`.** It's the one processor
with real service dependencies (`YoutubeTokenService`, `SchedulesService`).
Every other processor (download, transcription, clip-detection, render) is
a stateless "POST the payload, return" dispatcher. Forcing `PublishProcessor`
into `QueueModule` alongside them would require a circular import back into
`SchedulesModule`. Keeping it in `SchedulesModule` — the domain it actually
belongs to — avoids that entirely; the `PUBLISH` queue registration itself
stays in the `@Global()` `QueueModule` so `@InjectQueue` still resolves.

**Why the access token travels in the job payload, not a lookup by ID.**
`publish-worker` has no direct DB access (ADR-002 — Python workers are pure
HTTP services). The alternative would be an extra round-trip
(`GET /internal/users/:id/youtube-token`) that adds latency and another
attack surface. Passing the already-decrypted, already-fresh token in the
job body — over the internal Docker/K8s network, never logged, never
persisted to disk in `publish-worker` — is simpler and the token's blast
radius is already limited to a single upload attempt.

**Why quota postponement is 24h flat, not smarter.** The spec (§14.4) calls
for a flat 24h postponement on quota exceeded. A smarter version would read
the `quotaUser` reset time from Google's response headers, but Google
doesn't reliably expose that for the Data API v3 the way it does for some
other APIs. 24h flat is simple, matches the spec, and is safely
conservative — quota resets at midnight Pacific, so worst case a schedule
originally due at 11pm waits ~25h instead of ~1h. Acceptable for v1.

**What "publish" means for `privacyStatus`.** `youtube_uploader.py` hardcodes
`privacyStatus: "public"` and does not use YouTube's native `publishAt`
scheduling parameter — we do our own scheduling via BullMQ delay and only
call the YouTube API once the time has actually arrived, uploading directly
as public. This sidesteps YouTube's own `publishAt` quirks (it requires
`privacyStatus: "private"` at upload time, which adds a second API call to
flip it public later) in favor of one clean atomic upload at the right moment.

## How to test locally

1. `pnpm install` (picks up `@nestjs/schedule`).
2. Apply for a YouTube quota increase **today** if you haven't (§14.4) —
   default quota supports only ~6 uploads/day, which you'll burn through
   fast in testing.
3. `docker compose -f infrastructure/docker/docker-compose.yml up -d --build`
   (now also builds `publish-worker`).
4. Get a Short into `/shorts` review queue (full PR 1–3 flow).
5. Approve it, pick "5 minutes from now" as the schedule time, confirm.
6. Watch `/scheduler` — the entry should be `PENDING`, then flip to
   `PUBLISHED` within ~5 minutes with no manual action.
7. Click the calendar entry → "View on YouTube →" should open a real,
   playable video.
8. **Idempotency test:** manually re-add the same BullMQ job
   (`publish_<scheduleId>`) via Bull Board's retry button after it's already
   `PUBLISHED`. Confirm no second video appears on the channel and the
   schedule stays `PUBLISHED` (check `publish-worker` logs — should show
   the `idempotent.already_uploaded` skip path).
9. **Cancel test:** schedule something 30+ minutes out, cancel it from
   `/scheduler`, confirm Bull Board shows the job removed and the schedule
   is `CANCELLED`.
10. **Stuck-schedule test:** stop `publish-worker`, let a schedule's time
    pass, wait 30+ minutes, confirm `checkStuckSchedules` marks it `FAILED`
    with a clear error message (check API logs for `schedule.stuck_check`).
11. **RBAC check:** `VIEWER` role should get 403 on `POST /schedules` and
    `DELETE /schedules/:id`.
12. **Tenant isolation:** confirm `GET /schedules` for Org A never returns
    Org B's schedules (same pattern as PR 3's Clips/Shorts tests).

## Deliberately deferred

- **Distributed lock for the cron jobs.** Both `@Cron` jobs
  (`refreshNearlyExpiredTokens`, `checkStuckSchedules`) will double-fire if
  the API ever runs on more than one pod. Flagged with a `TODO(ops)` comment
  in `youtube-token.service.ts`. Harmless today (single replica; double
  refresh is wasteful, not incorrect) but must be fixed with a Redis lock
  before horizontal scaling.
- **`publishAt`-based native YouTube scheduling.** We do our own scheduling
  via BullMQ delay + upload-at-the-right-moment rather than YouTube's native
  `status.publishAt` field. See the design note above.
- **Retry UI for FAILED schedules.** `/scheduler` shows the failure reason
  but there's no "Retry" button yet — the user has to go back to `/shorts`
  and the Short is still `APPROVED`, so re-scheduling works, it's just not
  one click from the calendar view.
- **Bulk scheduling.** §11.3 mentions "bulk approve with shared schedule
  time" for the review queue — not built. Each Short is scheduled
  individually for now.

## Next up (per the updated root README)

**Analytics pipeline** — daily sync cron pulling from the YouTube Analytics
API, `/analytics` dashboard with real charts. This is the PR that proves the
pipeline is actually worth running.
