# PR 1 — Settings/Channels UI + YouTube OAuth connect flow (§14.1)

First of the README's "Next 3 PRs". Scope: connect flow only — auto-refresh
cron (§14.2) and publish-worker (Day 14) are separate, later PRs that build
on top of the fields this PR starts populating.

## What's in this PR

**Backend**
- `apps/api/src/common/crypto/encryption.service.ts` (+`crypto.module.ts`, global) —
  AES-256-GCM, lazy key load. Encrypts YouTube tokens before they touch the DB (§9.1).
- `apps/api/src/youtube/youtube-oauth.service.ts` (+`youtube.module.ts`) —
  builds the Google consent URL, verifies the signed `state` round-trip,
  exchanges the code, fetches the connected channel, encrypts + stores
  tokens on `User`, upserts the `Channel` row.
- `AuthController` — two new routes:
  - `GET /auth/youtube/connect` (Admin/Owner, JWT-protected) → `{ url }`
  - `GET /auth/youtube/callback` (public — Google redirects here) → redirects
    the browser to `/settings?channelConnected=true` or `/settings?error=...`
- `ChannelsController` — `PATCH /channels/:id/disconnect` (Admin/Owner),
  soft-disconnect via `isActive: false`.
- `videos.module.ts`, `auth.module.ts`, `app.module.ts` — wired up to the new
  `YoutubeModule` / `CryptoModule`. `youtube.service.ts` itself is unchanged.

**Frontend**
- `apps/web/app/(app)/settings/page.tsx` (new — this route didn't exist yet) —
  lists connected channels, "Connect YouTube channel" button, disconnect
  button, success/error banner driven by the OAuth redirect's query params.

No new dependencies — token exchange and the channels.list call use the
native `fetch()` already used in `youtube.service.ts`, same pattern as the
rest of the API.

## How to test locally

1. In Google Cloud Console, create an OAuth 2.0 Web client. Redirect URI:
   `http://localhost:3001/api/v1/auth/youtube/callback`. Enable the YouTube
   Data API v3.
2. Fill `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` in `apps/api/.env`.
3. Set a real `ENCRYPTION_KEY`: `openssl rand -hex 32`.
4. `pnpm dev`, log in (`admin@dev.local` / `password123`), go to `/settings`.
5. Click **Connect YouTube channel** → Google consent screen → redirected
   back to `/settings?channelConnected=true` with the channel listed,
   `isActive: true`.
6. Click **Disconnect** → badge flips to "Disconnected"; the row (and any
   Videos/Shorts already tied to it) stays — nothing is deleted.
7. Reconnect by clicking **Connect YouTube channel** again → `isActive`
   flips back to `true` on the same channel row (upsert on `youtubeChannelId`).
8. RBAC check: log in as an `EDITOR` or `VIEWER` — both
   `/auth/youtube/connect` and `/channels/:id/disconnect` should 403.
9. Edge case: try connecting the same YouTube channel from a second
   workspace/org — should fail with "already connected to another workspace"
   (`ConflictException`), not silently steal the channel.

## Deliberately deferred (called out, not forgotten)

- **§14.2 token auto-refresh cron** — not wired yet. `ytTokenExpiry` and the
  encrypted refresh token are already on `User`; this PR just doesn't add the
  `@Cron('*/55 * * * *')` job that consumes them. Needed before publish-worker
  (Day 14) goes live — that's PR 3's problem, not this one's.
- **Token revocation on disconnect** — disconnect today only flips
  `isActive`; it doesn't call Google's revoke endpoint or clear the stored
  tokens. Intentional for now (disconnect is meant to be reversible — see
  step 7 above), but worth revisiting if "disconnect" should mean "revoke."
- **Branding section of `/settings`** (logo, brand color, Slack webhook, API
  keys — §11.6) — out of scope, this PR is Channels only.

## Next up (per README, PR 2)

`transcription-worker` (Faster-Whisper, word timestamps) + WebSocket gateway
(`video:status` events) so `/videos` stops polling — Day 6 of the roadmap.
