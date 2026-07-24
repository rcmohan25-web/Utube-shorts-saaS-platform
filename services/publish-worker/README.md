# publish-worker

Implements §14.3 — resumable upload to the YouTube Data API v3. FastAPI HTTP
service, same shape as the other workers: NestJS's `PublishProcessor` fetches
a fresh OAuth access token (via `YoutubeTokenService`) and POSTs the job here
along with that token; this service downloads the Short's MP4 from S3/R2,
uploads it to YouTube in 10 MB chunks, sets the thumbnail, and calls back to
one of three NestJS endpoints depending on the outcome.

## Run locally

```bash
cd services/publish-worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8004
```

Or via `infrastructure/docker/docker-compose.yml` (`publish-worker` service).

## Status

✅ Implemented (Day 14 of the roadmap — "Full loop live" milestone).

Three possible outcomes, three different callbacks:
- **Success** → `PATCH /schedules/:id/complete` — marks Schedule PUBLISHED,
  cascades to Short PUBLISHED, logs a UsageEvent.
- **YouTube quota exceeded (403 `quotaExceeded`)** → `PATCH /schedules/:id/quota-exceeded`
  — NestJS postpones every PENDING schedule on that channel by 24h. This is
  distinct from a generic failure — see §14.4 in the implementation plan.
- **Any other failure** → `PATCH /schedules/:id/failed` — BullMQ's own retry
  policy (5x exponential, §7.1) handles transient failures at the dispatch
  level; this callback handles failures that happen *after* dispatch
  succeeded (mid-upload network errors, invalid file, etc).

## Key design notes

- **The access token is never stored here.** `PublishProcessor` in NestJS
  calls `YoutubeTokenService.getValidAccessToken()` immediately before
  dispatch, guaranteeing the token has at least 5 minutes of headroom. The
  token travels once, in the job payload, over the internal Docker/K8s
  network — not persisted to disk or logged.
- **Idempotency lives in NestJS, not here.** `PublishProcessor` checks
  `Short.youtubeVideoId` before ever calling this service. If a previous
  attempt uploaded successfully but the callback failed, NestJS finalizes
  without re-invoking this worker.
- **Callback retries.** If NestJS is briefly unreachable (mid-deploy), the
  callback functions retry up to 3 times with exponential backoff before
  giving up. If all three fail, the schedule sits in a state NestJS's
  stuck-schedule cron (`checkStuckSchedules`, every 10 min) will catch and
  mark FAILED after 30 minutes past `scheduledAt`.
