# PR 2 — transcription-worker + WebSocket gateway (§6.1 stage 4, §8.3)

Second of the README's "Next 3 PRs." Includes one unplanned but necessary
fix — see "Bug found & fixed" below.

## Bug found & fixed: queues had no real consumer

`videos.service.ts` was already calling `downloadQueue.add(...)` and
`transcriptionQueue.add(...)`, but nothing in `apps/api` was ever registered
to *consume* those BullMQ queues — no `@Processor` existed for either. The
only thing that looked like a consumer was a background thread in
`services/clip-worker/main.py` doing `redis_client.lrange(QUEUE_NAME, 0, 0)`
against plain Redis lists. That doesn't work: BullMQ stores jobs across
several Redis data structures under a `bull:<queue>:*` key prefix (wait
list, active list, job hashes, etc.), not a flat list named after the queue.
That code would never actually pick up a real job.

Fix, consistent with ADR-002 ("NestJS dispatches, Python processes, Python
calls back over HTTP"): added real `@Processor` classes on the NestJS side
that consume the queue and POST the payload to the Python service's
`/jobs/*` endpoint. Removed the dead Redis-polling thread from clip-worker.

## What's in this PR

**Backend**
- `apps/api/src/queues/processors/video-download.processor.ts` (new) —
  consumes `video-download`, POSTs to `{CLIP_WORKER_URL}/jobs/download`.
- `apps/api/src/queues/processors/transcription.processor.ts` (new) —
  consumes `transcription`, POSTs to `{TRANSCRIPTION_WORKER_URL}/jobs/transcribe`.
- `apps/api/src/websockets/video.gateway.ts` + `websockets.module.ts` (new) —
  Socket.IO gateway. JWT-verified at handshake, joins `org:{orgId}` room,
  exposes `emitVideoStatus(orgId, payload)`.
- `videos.service.ts` — calls `videoGateway.emitVideoStatus(...)` on import
  (PENDING) and on every worker status callback (DOWNLOADING → ... → READY/FAILED).
- `apps/api/package.json` — added `@nestjs/websockets`, `@nestjs/platform-socket.io`,
  `socket.io` as explicit dependencies (they were already resolved in
  `pnpm-lock.yaml` transitively but missing from `package.json` itself —
  fixed the drift while I was in here).

**Python**
- `services/transcription-worker/` (new) — `main.py`, `whisper_service.py`
  (Faster-Whisper, model loaded once at startup, `WHISPER_MODEL` env-configurable),
  `s3_client.py`, `requirements.txt`, `Dockerfile`, `.env.example`.
- `services/clip-worker/main.py` — removed the broken Redis-polling consumer
  (see above). `/jobs/download` and `/health` are unchanged.
- `services/clip-worker/requirements.txt` — dropped the now-unused `redis` dep.

**Frontend**
- `apps/web/lib/socket.ts` (new) — shared authenticated Socket.IO client.
- `apps/web/app/(app)/videos/page.tsx` — replaced the 5s polling `setInterval`
  with a `video:status` socket subscription that patches just the changed row.
  Added a small Live/Connecting indicator.
- `apps/web/package.json` — added `socket.io-client`.

**Infra**
- `infrastructure/docker/docker-compose.yml` — added the `transcription-worker` service.
- Root `README.md` — status table + test steps updated.

## How to test locally

1. `pnpm install` (picks up the new `socket.io-client` / websocket deps).
2. `docker compose -f infrastructure/docker/docker-compose.yml up -d` (now
   also builds/runs `transcription-worker`).
3. `pnpm dev`, log in, connect a channel (PR 1), import a video on `/videos`.
4. Watch the badge move PENDING → DOWNLOADING → DOWNLOADED → TRANSCRIBING →
   READY *live*, with the "Live" indicator green — no page refresh, no polling.
5. Check Redis/Bull Board: the `video-download` and `transcription` queues
   should show jobs completing (dispatch acknowledged), not piling up in `wait`.
6. Check S3/R2: `transcript.json` should land at
   `{orgId}/raw-videos/{videoId}/transcript.json` with word-level timestamps.
7. Negative test: stop `transcription-worker`, import a video — the
   `transcription` job should retry per its backoff policy (§7.1: 2x
   exponential) and eventually sit in BullMQ's failed set, visible in Bull Board.

## Deliberately deferred

- **Granular progress** — `STAGE_PROGRESS` in `videos.service.ts` is a coarse
  per-stage number (0/20/40/60/100), not a true percentage within a stage.
  Real intra-stage progress would need chunked reporting from ffmpeg/Whisper;
  not worth the complexity yet.
- **Socket reconnect resilience** — if the socket drops and reconnects, any
  status changes that happened while disconnected are simply missed until
  the next manual refresh. No "catch-up" fetch on reconnect yet.
- **Token refresh over the socket** — the gateway verifies the access token
  once at handshake; if it expires mid-session the socket just keeps running
  rather than being kicked. Fine for a 15-minute access token in dev; would
  want revisiting before this matters in prod.

## Next up (per README, PR 3)

`clip-detection` (GPT-4o scoring prompt, §6.2) + `render-worker` (smart crop +
ASS captions, §6.3–6.4) — the Day 7 milestone: first playable Short in the browser.
