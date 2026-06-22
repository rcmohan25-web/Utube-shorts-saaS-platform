# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs, started
at the Day 1–5 milestone from the v2 execution plan (§20.10):

> Paste URL → DB row → job dispatched → video downloaded & audio extracted → status visible in UI.

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, all 12 tables) | ✅ |
| `packages/shared` — cross-app types | ✅ |
| `apps/api` (NestJS) — Auth (register/login/refresh-rotation/me) | ✅ |
| `apps/api` — Tenant isolation (`TenantInterceptor`, RBAC `RolesGuard`) | ✅ |
| `apps/api` — Videos (import → upsert → BullMQ dispatch), Channels | ✅ |
| `apps/api` — Video status state machine (§20.2) | ✅ |
| `apps/api` — Worker callback endpoint (internal-secret guarded) | ✅ |
| `services/clip-worker` (Python/FastAPI) — yt-dlp download + ffmpeg audio extract | ✅ |
| `apps/web` (Next.js) — login/register, dashboard, video import + status grid | ✅ |
| Transcription / clip-scoring / render / publish workers | 🚧 stubs only — see `services/*/README.md` |
| WebSocket live progress, Scheduler, Analytics, Billing, RBAC UI, Stripe | ⏳ not started — next sprints |

This intentionally stops short of the full 20-section spec. Build one
vertical slice end-to-end first (validate it works, get feedback), *then*
layer on transcription → clip scoring → render → publish → billing, exactly
as the roadmap's Week 1/Week 2/Month-2-3 plan lays out.

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker.

```bash
# 1. Install JS deps
corepack enable && corepack prepare pnpm@9.7.0 --activate
pnpm install

# 2. Start infra
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Configure env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
cp services/clip-worker/.env.example services/clip-worker/.env
# fill in YOUTUBE_API_KEY (optional for Day 4 — falls back to a stub title),
# S3/R2 + AWS_* if you want real uploads to work

# 4. Migrate + seed DB
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev --name init
pnpm --filter @shorts/db seed   # creates admin@dev.local / password123 + demo org

# 5. Start API + web
pnpm dev

# 6. Start the Python worker (separate terminal)
cd services/clip-worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8002
```

Then:
- Web: http://localhost:3000/login
- API: http://localhost:3001/api/v1/auth/me · Swagger at http://localhost:3001/docs
- Bull Board: http://localhost:3030
- pgAdmin: http://localhost:5050

## First end-to-end test

1. Log in with the seeded demo account.
2. You'll need a channel row before importing a video — `POST /api/v1/channels`
   with `{ "youtubeChannelId": "UC...", "name": "My Channel" }` (Bearer token
   from login). A `/settings` UI for this is the next page to build.
3. Go to `/videos`, paste a YouTube URL, hit Import.
4. The API upserts a `Video(PENDING)` row and pushes a `video-download` job
   onto BullMQ — check Bull Board to see it queued.
5. If the clip-worker is running, it downloads the video, extracts audio,
   uploads both to S3/R2, and PATCHes the video to `DOWNLOADED` — which
   chains into a (currently stubbed) `transcription` job.
6. Refresh `/videos` — the status badge updates (polling every 5s; swap for
   the WebSocket gateway described in §8.3 next).

## Why these specific choices

See the architecture docs in `/mnt/project` for full rationale (ADRs on
shared-schema multi-tenancy, BullMQ-over-Celery, R2-over-S3). The short
version: every Prisma query in `apps/api` **must** be scoped by
`organizationId` — `TenantInterceptor` puts it on the request, and the code
review checklist in the v2 plan (§20.13) is the bar for every PR.

## Next 3 PRs, in order

1. **Settings/Channels UI** + YouTube OAuth connect flow (§14.1) — unblocks
   real channel data instead of manual `POST /channels`.
2. **transcription-worker** (Faster-Whisper, word timestamps) + **WebSocket
   gateway** (`video:status` events) so the UI stops polling.
3. **clip-detection** (GPT-4o scoring prompt, §6.2) + **render-worker**
   (smart crop + ASS captions, §6.3–6.4) — this closes the loop to a
   playable Short, the Day 7 milestone.
