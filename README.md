# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects through the **Day 7–10 milestone** (§20.10–§20.11):
first playable Short, end to end, in the browser.

> Paste URL → DB row → job dispatched → video downloaded & audio extracted →
> transcribed with word timestamps → GPT-4o scores candidate clips → human
> approves one → render-worker crops/captions/encodes it → plays back as a
> 9:16 Short in the review queue.

## What's built

| Layer | Status |
| --- | --- |
| Monorepo (pnpm workspaces + Turborepo) | ✅ scaffolded |
| `packages/db` — full Prisma schema (multi-tenant, all 12 tables + PR3's two additive columns) | ✅ |
| `packages/shared` — cross-app types | ✅ |
| `apps/api` (NestJS) — Auth (register/login/refresh-rotation/me) | ✅ |
| `apps/api` — Tenant isolation (`TenantInterceptor`, RBAC `RolesGuard`) | ✅ |
| `apps/api` — Videos (import → upsert → BullMQ dispatch), Channels | ✅ |
| `apps/api` — Video status state machine (§20.2) | ✅ |
| `apps/api` — YouTube OAuth connect flow (§14.1) + Settings/Channels UI | ✅ |
| `apps/api` — BullMQ → HTTP dispatch processors (download, transcription, clip-detection, render) | ✅ |
| `apps/api` — WebSocket gateway (`video:status`, `clip:created`, `short:ready` — org-scoped, §8.3) | ✅ |
| `apps/api` — Clips domain (bulk-create from worker, approve → dispatches render, reject) | ✅ |
| `apps/api` — Shorts domain (create from worker, presigned URLs, approve/reject, `transitionShort` FSM) | ✅ |
| `apps/api` — S3/R2 presigned URL service (`StorageService`) | ✅ |
| `services/clip-worker` — yt-dlp download, ffmpeg audio extract, PySceneDetect + GPT-4o clip scoring (§6.2) | ✅ |
| `services/transcription-worker` — Faster-Whisper, word timestamps | ✅ |
| `services/render-worker` — clip extraction, face-centered crop (§6.3), ASS captions (§6.4), encode, thumbnail | ✅ |
| `apps/web` — login/register, Settings (channels), Videos (live status + clip review), Shorts (review queue + player) | ✅ |
| `services/publish-worker`, §14.2 token-refresh cron, Scheduler, Analytics, Billing, Stripe | ⏳ not started |

## Run it locally

Requires Node 20+, pnpm 9+, Python 3.11+, Docker.

```bash
# 1. Install JS deps
corepack enable && corepack prepare pnpm@9.7.0 --activate
pnpm install

# 2. Start infra (postgres, redis, pgadmin, bull-board,
#    clip-worker, transcription-worker, render-worker)
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Configure env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
cp services/clip-worker/.env.example services/clip-worker/.env
cp services/transcription-worker/.env.example services/transcription-worker/.env
cp services/render-worker/.env.example services/render-worker/.env
# fill in: ENCRYPTION_KEY (openssl rand -hex 32), YouTube OAuth client id/secret,
# OPENAI_API_KEY (clip-worker needs this for GPT-4o scoring), S3/R2 credentials

# 4. Migrate + seed DB
pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev --name init
pnpm --filter @shorts/db seed   # creates admin@dev.local / password123 + demo org

# 5. Start API + web
pnpm dev
```

Then:
- Web: http://localhost:3000/login
- API: http://localhost:3001/api/v1/auth/me · Swagger at http://localhost:3001/docs
- Bull Board: http://localhost:3030
- pgAdmin: http://localhost:5050

## First end-to-end test (the Day 7–10 milestone)

1. Log in with the seeded demo account.
2. `/settings` → **Connect YouTube channel** (real Google OAuth client required, §14.1).
3. `/videos` → paste a YouTube URL → Import. Watch the badge move live:
   PENDING → DOWNLOADING → DOWNLOADED → TRANSCRIBING → READY.
4. Click into the video. Once READY, GPT-4o-scored clips appear automatically
   (no refresh) sorted by confidence, each with a score, suggested title,
   transcript excerpt, and reasoning.
5. **Approve** a clip. This dispatches a render job — crop, captions,
   optional branding, encode, thumbnail.
6. Go to `/shorts`. The rendered Short appears in the review queue the
   moment it's done (pushed over WebSocket, not polled). Click it, watch it
   play 9:16 with burned-in word-pop captions, Approve or Reject.

## Why these specific choices

See the architecture docs in `/mnt/project` for full rationale (ADRs on
shared-schema multi-tenancy, BullMQ-over-Celery, R2-over-S3). The short
version: every Prisma query in `apps/api` **must** be scoped by
`organizationId` — `TenantInterceptor` puts it on the request, and the code
review checklist in the v2 plan (§20.13) is the bar for every PR.

Per ADR-002, Python workers are HTTP services, not BullMQ consumers — the
four processors in `apps/api/src/queues/processors/` are the only things
that actually pull jobs off Redis; each one POSTs to its Python service and
lets that service report progress back via a status callback. Workers never
touch Postgres directly.

State machines exist for both `Video` (`video-status.machine.ts`) and
`Short` (`short-status.machine.ts`, added in PR 3) — direct status writes
outside those files are a code-review reject per §20.13. `Clip` doesn't get
one; its 3-state lifecycle (PENDING/APPROVED/REJECTED) is simple enough for
a direct conditional check.

PR-specific design notes (pre-generating the Short id before it exists,
skipping MoviePy/Pillow, the bug found in clip-worker's old BullMQ
"consumer") live in `PR-01-NOTES.md` / `PR-02-NOTES.md` / `PR-03-NOTES.md`
at the repo root — kept rather than squashed away, since the reasoning is
often more useful than the diff.

## Next up

The original "Next 3 PRs" from this README are now done (Settings/OAuth →
transcription + WebSocket → clip-detection + render). What's left maps onto
the plan's Week 2 / Month 2–3 milestones (§20.11–§20.12):

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Scheduler + publish-worker** | Shorts can render and sit in REVIEW, but there's no way to actually publish one to YouTube yet. Needs `POST /schedules` + a BullMQ delayed job, a `/scheduler` calendar page, `publish-worker` (resumable upload, §14.3), and finally wiring §14.2's token-refresh cron (deferred since PR 1) — publish-worker needs a *live* access token, not a 60-minute-stale one. | §7.1, §13.3 steps 5–6, §14.2–14.4, Day 13–14 |
| 2 | **Analytics pipeline** | Daily sync cron + `/analytics` dashboard. Right now there's no feedback loop showing whether any of this actually drives views. | §17, Week 3 |
| 3 | **Stripe billing + quota enforcement** | `checkAndConsumeQuota` (§13.2) is designed in the spec but not wired into the publish path yet. Can't actually charge anyone. | §13, Week 5 |
| 4 | **Security hardening pass** | Pen-test-style review of the new internal-secret-guarded worker callbacks, rate limits on `/clips` and `/shorts`, IDOR checks (Org A can't reach Org B's clip/short by guessing an id). | §18.2, §19.1, Week 7 |

Pick #1 first — it's the one that turns "Shorts render" into "Shorts get
published," which is the actual product.
