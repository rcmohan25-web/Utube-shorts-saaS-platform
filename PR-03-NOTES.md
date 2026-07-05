# PR 3 — clip-detection (GPT-4o) + render-worker (smart crop + ASS captions)

Third of the README's original "Next 3 PRs." This is the one that closes
the loop to a playable Short — Day 7–10 of the roadmap (§20.10–§20.11),
done as one PR rather than three incremental days, since the README framed
clip-detection and render-worker as a single unit.

## What's in this PR

**Backend — new domains**
- `apps/api/src/clips/` — `ClipsService`/`ClipsController`. Bulk-creates
  clips from clip-worker's GPT-4o callback, `PATCH /clips/:id/approve`
  (dispatches a render job), `PATCH /clips/:id/reject`.
- `apps/api/src/shorts/` — `ShortsService`/`ShortsController` +
  `short-status.machine.ts` (a `transitionShort()` FSM mirroring
  `video-status.machine.ts`, per the §20.13 review checklist). `POST /shorts`
  (render-worker's callback, always a create), `GET /shorts`, `GET /shorts/:id`
  (presigned render + thumbnail URLs), approve/reject.
- `apps/api/src/storage/` — `StorageService`, a thin wrapper around
  `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` for generating
  60-minute presigned GET URLs (§9.4 — the bucket is private, nothing is
  ever exposed as a raw key or public URL).
- `apps/api/src/queues/processors/clip-detection.processor.ts` +
  `render.processor.ts` — same dispatch pattern as PR 2's processors.
  `RenderProcessor` is the one exception that does its own Prisma lookups
  (Clip → Video → Organization) before calling out, since the BullMQ
  payload is deliberately minimal and branding shouldn't be baked into a
  job that might sit queued for a while.
- `videos.service.ts` — now also dispatches a `clip-detection` job when a
  Video hits `READY` (transcription done), chaining the third pipeline stage.
- `apps/api/package.json` — added `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.
- `apps/api/.env.example` — added `CLIP_WORKER_URL` / `TRANSCRIPTION_WORKER_URL`
  / `RENDER_WORKER_URL`. **Gap fix:** these were already read by PR 2's
  processors (with hardcoded fallback defaults) but never actually written
  down in the env template — fixed here.

**Database**
- `packages/db/prisma/schema.prisma` — two additive, nullable columns:
  `Clip.rejectionReason`, `Short.errorMessage`. Both follow the §20.5
  expand-only pattern (safe while the app is live, no contract phase needed).
- New migration: `20260628120500_add_clip_short_error_fields`.

**Python — clip-worker (extended)**
- `scene_detector.py` (new) — PySceneDetect `AdaptiveDetector` for scene
  boundaries, plus a sliding-window segment builder (45–90s, §6.2's rules)
  annotated with scene-cut count and a rough RMS amplitude per window.
- `clip_scorer.py` (new) — the exact §6.2 GPT-4o prompt/response contract.
- `main.py` — added `/jobs/detect-clips`, refactored the shared HTTP-callback
  helpers (`patch_video_status`, new `post_clips`).
- `s3_client.py` — added `download_file` (was upload-only).
- `requirements.txt` / `Dockerfile` — added `opencv-python-headless`,
  `scenedetect`, `openai`, `numpy`; Dockerfile gained `libgl1`/`libglib2.0-0`
  (opencv-python-headless still wants these on Debian slim).

**Python — render-worker (new service)**
- `main.py` — the full stage 7–14 pipeline: stream-copy clip extraction →
  face-centered crop → ASS captions (re-zeroed to the clip's own timeline) →
  burn-in + final encode → optional branding overlay → thumbnail → upload →
  `POST /shorts`.
- `vertical_cropper.py` — §6.3's algorithm verbatim (4-sample-point Haar
  cascade face detection, center-of-mass crop, center fallback).
- `caption_generator.py` — §6.4's word-pop ASS format, including the
  `\t(0,50,\fscx112\fscy112)` pop animation tag on high-confidence words.
- `s3_client.py`, `ffmpeg_utils.py`, `requirements.txt`, `Dockerfile`, `.env.example`.

**Frontend**
- `apps/web/app/(app)/videos/[id]/page.tsx` (new) — this route didn't exist
  before PR 3. Shows clips sorted by confidence, live-updates on
  `clip:created`/`video:status`, Approve/Reject.
- `apps/web/app/(app)/shorts/page.tsx` (new) — review queue, live-updates on
  `short:ready`, click-through to a player modal with presigned video URL,
  Approve/Reject.
- `apps/web/app/(app)/videos/page.tsx` — video cards are now links to the
  new detail page (they weren't clickable before; the detail route simply
  didn't exist until this PR).

**Infra & docs**
- `infrastructure/docker/docker-compose.yml` — added `render-worker`.
- Root `README.md` — status table, test steps, and a **new forward-looking
  roadmap** replacing the now-fully-delivered "Next 3 PRs" section.
- This file.

## Key design decisions (read this before reviewing the diff)

**The Short's id is generated before the Short exists.** §10.1's bucket
layout is `renders/{shortId}/...`, but the row can't be created until
render-worker finishes (success *or* failure — see below), which is after
the files are already uploaded. Chicken-and-egg. Fixed by having
`ClipsService.approve()` generate a `randomUUID()` for the Short up front,
threading it through the BullMQ job → `RenderProcessor` → render-worker's
job payload → render-worker uses it directly for the S3 path → and
`POST /shorts`'s callback DTO includes the same id, which `ShortsService`
uses as the literal primary key (`Prisma.create({ data: { id: shortId } })`,
overriding the `@default(cuid())`). Postgres doesn't care that it's a UUID
instead of a cuid — it's just a `String @id` column.

**The Short row is always *created*, never updated into existence.**
Originally I drafted this as "create a `RENDERING` placeholder row at
approve-time, then `PATCH` it to `REVIEW`/`FAILED` later" — which would have
needed `transitionShort()` to allow `RENDERING -> REVIEW/FAILED`. I reverted
that: the spec's own Day-7 task literally says "Create Short record (status:
REVIEW)," and parallels how `Video` rows are inserted directly at `PENDING`
rather than through `transitionVideo()`. So `short-status.machine.ts`'s
`RENDERING` entry exists for schema completeness (the enum's literal
default) but is dead code in practice — render-worker's callback always
creates fresh, at `REVIEW` or `FAILED` directly.

**MoviePy and Pillow were skipped.** The spec calls for MoviePy (branding
composite) and Pillow (thumbnail text overlay). Branding is implemented as
a single FFmpeg `overlay` filter instead — there's no Settings UI yet to
actually upload an org logo (§11.6, not built), so dragging in a full
MoviePy dependency for a path that's currently always a no-op isn't worth
it. Thumbnail is a plain FFmpeg frame grab with no text overlay — Pillow
would need a bundled font file in the Docker image for not much payoff
right now. Both are easy to add later; flagging now so it's a deliberate
choice, not an oversight.

**`RenderProcessor` looks things up fresh instead of trusting the queued
payload.** The other three processors (download, transcription,
clip-detection) just forward whatever `videos.service.ts` already had in
hand. `RenderProcessor` is different: it re-fetches Clip → Video →
Organization at dispatch time, specifically so branding (`logoS3Key`,
`brandColor`) reflects whatever the org has configured *right now*, not
whatever it was when the human clicked Approve — relevant once renders can
actually queue up for a while.

## How to test locally

1. `pnpm install`, `pnpm --filter @shorts/db migrate:dev`, `pnpm --filter @shorts/db generate`.
2. Fill `OPENAI_API_KEY` in `services/clip-worker/.env` — without it,
   clip-detection will fail every job (caught, reported as an empty clip
   list, logged loudly; nothing crashes, you just won't see any clips).
3. `docker compose -f infrastructure/docker/docker-compose.yml up -d --build`
   (now also builds `render-worker`).
4. Run the full flow from the root README's "First end-to-end test" section.
5. Check Bull Board: `clip-detection` and `render` queues should show jobs
   completing (dispatch acknowledged), same as PR 2's queues.
6. Check S3/R2: `{orgId}/renders/{shortId}/short.mp4`, `thumbnail.jpg`,
   `short.ass` should all exist after an approve.
7. RBAC check: log in as `VIEWER` — `/clips/:id/approve`, `/clips/:id/reject`,
   `/shorts/:id/approve`, `/shorts/:id/reject` should all 403.
8. Negative test: stop `render-worker`, approve a clip — the `render` job
   should retry (3x exponential, §7.1) and land in BullMQ's failed set.
9. Negative test: approve the same clip twice — second call should 400
   ("Clip is already approved"), not silently queue a duplicate render.

## Deliberately deferred

- **Granular render progress.** There's no "Short is 40% rendered"
  indicator — `/shorts` just shows nothing until `short:ready` fires.
  Same trade-off as PR 2's coarse `STAGE_PROGRESS`.
- **`/clips/:id/rerender` / re-running a failed render.** `short-status.machine.ts`
  defines `FAILED -> RENDERING` and `REJECTED -> RENDERING` for this, but no
  endpoint triggers it yet.
- **Org branding UI.** `Organization.logoS3Key`/`brandColor` are read by
  `RenderProcessor` but there's still no Settings UI to set them (§11.6).
- **`description` on Short.** The schema has it; nothing populates it yet
  (GPT-4o's `suggestedDescription` is currently dropped — only title/tags
  flow through). Cheap to add when something needs it.

## Next up (per the updated root README)

**Scheduler + publish-worker** — `POST /schedules`, a BullMQ delayed job, a
`/scheduler` page, `publish-worker` (resumable YouTube upload, §14.3), and
finally wiring §14.2's token-refresh cron that's been sitting unused since
PR 1. This is the PR that turns "Shorts render" into "Shorts get published."
