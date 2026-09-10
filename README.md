# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects three combined milestones shipped back to back:

- **PR 10 — Agency White-Label Features** (§15.2, Phase 6): client
  sub-organizations, an agency health/usage dashboard, org-scoped API
  keys with a minimal public REST API, CSV bulk import — all behind a
  real plan-gated feature-flag system (§20.7).
- **PR 11 — Audit Log Admin UI** (§9.4 follow-up): the compliance trail
  PR 9 started writing and PR 10 extended is now readable from the
  product — filterable, cursor-paginated.
- **PR 12 — Full White-Label Branding Pass** (§15.2, README "Next up"
  #1): `Organization.logoS3Key` / `brandColor` have existed in the schema
  since the very first migration but nothing ever read them. This PR
  wires them into the app shell, every outbound email, and every newly
  rendered Short's caption/overlay — and hides "Powered by Shorts Pilot"
  everywhere once an org is Agency+. **This is now packaged as a
  complete, drop-in file set — see `SETUP_INSTRUCTIONS_PR12.md`.**

> Paste URL → DB row → job dispatched → video downloaded & audio
> extracted → transcribed with word timestamps → GPT-4o scores candidate
> clips → human approves one → render-worker crops/captions/encodes it
> **with this org's own brand color burned into the captions and its logo
> overlaid in the corner** → "Shorts ready" notification (**sent from a
> branded email with this org's logo and color**) → human approves →
> quota check (§13.2) → schedule → publish-worker uploads it to YouTube →
> "Short published" notification → daily analytics sync → Stripe
> subscription drives plan/quota → 80%/95% quota or payment-failure
> alerts → admins manage teammates from `/settings/users` → an
> Agency-plan org creates client sub-organizations from `/agency`, issues
> API keys from `/settings/api-keys`, bulk-imports a CSV of URLs, reviews
> `/settings/audit-log` — **and now: any org, on any plan, can upload a
> logo and set a brand color from `/settings/branding`, and Agency+ orgs
> additionally see "Powered by Shorts Pilot" disappear from the sidebar
> and every email footer.**

## What's built

| Layer | Status |
| --- | --- |
| Monorepo, DB schema, auth, tenant isolation, RBAC | ✅ |
| Full pipeline (import → download → transcribe → clip-score → render → publish) | ✅ |
| WebSockets, Analytics + daily sync, Stripe billing + quota | ✅ |
| Notifications (email/in-app/Slack), team invites, `/settings/users` | ✅ |
| `AuditLogService.record()` wired into every destructive action | ✅ |
| Named throttle buckets, `InternalSecretGuard`, tenant-isolation regression suite | ✅ |
| `packages/shared/feature-flags.ts` (`FLAGS`) — plan-gated feature policy | ✅ **PR 10** |
| `apps/api` — `FeatureGuard` / `@Feature(...)` | ✅ **PR 10** |
| `apps/api` — `AgencyModule`, `ApiKeysModule`, `PublicApiModule`, CSV bulk import | ✅ **PR 10** |
| `apps/web` — `/agency`, `/settings/api-keys` | ✅ **PR 10** |
| `apps/api` — `AuditLogService.query()` cursor pagination + filters | ✅ **PR 11** |
| `apps/api` — `AuditLogController` (`GET /audit-log`, `GET /audit-log/actions`) | ✅ **PR 11** |
| `apps/web` — `/settings/audit-log` filter bar + paginated table | ✅ **PR 11** |
| `apps/api` — `StorageService.getPresignedUploadUrl()` — direct-to-storage logo upload | ✅ **PR 12** |
| `apps/api` — `OrganizationsService`: `updateBranding()` extended (brandColor/logoS3Key), `requestLogoUploadUrl()`, `getPublicBranding()` | ✅ **PR 12** |
| `apps/api` — `GET/PUT /organizations/branding`, `POST /organizations/branding/logo-upload-url` | ✅ **PR 12** |
| `apps/api` — `EmailService` renders every outbound email with the sending org's logo/color and conditionally drops the "Powered by" footer | ✅ **PR 12** |
| `apps/api` — `NotificationsService.brandingFor()` resolves org branding once per `send()` call | ✅ **PR 12** |
| `services/render-worker` — `caption_generator.py` burns the org's `brandColor` into the ASS Highlight style (word-pop captions) | ✅ **PR 12** |
| `packages/shared/src/branding.ts` — `OrganizationBranding` type shared by API and web | ✅ **PR 12** |
| `apps/web` — `useBranding()` hook, `<PoweredByFooter/>`, `/settings/branding` (logo upload + color picker) | ✅ **PR 12** |
| `apps/web` — app shell shows this org's logo/name instead of the hardcoded wordmark | ✅ **PR 12** |
| Custom domain per client (`client.brand.com`) | ⏳ not started — DNS/Vercel infra, out of scope for app code |
| Branded PDF/CSV exports, branded onboarding emails beyond the invite email | ⏳ not started |
| Consolidated agency billing | ⏳ not started |
| Per-API-key rate limiting / scoping | ⏳ not started |
| Analytics API call batching | ⏳ not started |
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
# No new env vars for PR 12 — branding reuses S3_BUCKET/S3_ENDPOINT/
# AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, already required for renders.

pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev   # no new migration in PR 12 — logoS3Key/brandColor already exist
pnpm --filter @shorts/db seed

stripe listen --forward-to localhost:3001/api/v1/billing/webhook   # only if testing billing

pnpm dev
```

For the exact copy/apply steps for PR 12 specifically (as opposed to a
fresh clone), see **`SETUP_INSTRUCTIONS_PR12.md`** in this package — it
now ships as a complete, drop-in file set (every file listed is a full
replacement, not a diff/patch) under a mirrored directory tree
(`apps/api/...`, `apps/web/...`, `packages/shared/...`,
`services/render-worker/...`).

## Trying out PR 12 (branding)

The seeded demo org (`admin@dev.local` / `password123`) works immediately
— branding is **not** plan-gated, only the "Powered by" removal is:

1. Log in, go to `/settings/branding`.
2. Upload a logo (PNG/JPEG/SVG/WebP) — it appears in the sidebar within a
   few seconds (the upload flow is presign → PUT to S3/R2 → confirm).
3. Pick a brand color and save it. Notice the "White-label status" card:
   on `STARTER` it says the footer still shows.
4. Approve a clip and let it render (or check an existing rendered Short)
   — the word-pop captions' highlighted word now uses your brand color
   instead of the default yellow.
5. Trigger any email notification (e.g. reject then re-approve a clip to
   fire `SHORTS_READY`, or just check server logs — `RESEND_API_KEY` is
   unset in dev, so emails log instead of send) and see the branded HTML
   in the log payload.
6. Bump the demo org to Agency (see PR 10's section below for the SQL),
   log out/in for a fresh JWT, revisit `/settings/branding` — the
   white-label card flips to "hidden", and the sidebar's "Powered by"
   line disappears immediately (no relog needed, since the footer reads
   from `/organizations/branding`, not the JWT).

## Why these specific choices (PR 12)

**Branding itself isn't plan-gated — only its removal is.** §13.3's
onboarding flow already has "Upload branding — logo + brand color
(skippable)" as step 2 for every new org, regardless of plan. Only
§15.2's "Remove all 'Powered by' attribution" is Agency+-exclusive. So
`PUT /organizations/branding` and the logo-upload flow are available to
every authenticated Admin/Owner; `FLAGS.WHITE_LABEL(plan)` only gates
whether the footer disappears.

**Email logos are never presigned.** `NotificationsService.brandingFor()`
deliberately passes `logoUrl: null` to `EmailService` and falls back to
rendering the org name as styled text. A presigned S3/R2 GET URL expires
in 60 minutes; an email can sit unread for a week. Shipping an
almost-always-broken `<img>` would be worse than no logo. The app shell
and the Short-render pipeline don't have this problem — they resolve a
fresh presigned URL (or download the object directly) at the moment
they're actually used. A stable public asset URL for logos is one of the
things custom-domain support (still not started) would unlock.

**The upload flow is presign-then-confirm, not a multipart endpoint.**
Same shape as every other object write in this codebase: `POST
/organizations/branding/logo-upload-url` mints a key scoped to
`{orgId}/branding/logo-{uuid}.{ext}` and a short-lived (15 min) presigned
PUT URL; the browser uploads directly to S3/R2; only then does the
client call `PUT /organizations/branding` to confirm the new
`logoS3Key`. Our API process never buffers image bytes, matching the
pattern render-worker and every worker's S3 client already use.

**Brand color reaches the render pipeline through a field that already
existed.** `RenderProcessor` has sent `brandColor` in the render-worker
job payload since the very first render implementation (§20.10 Day 7–10)
— it just wasn't consumed. PR 12's actual code change on the Python side
is two functions in `caption_generator.py` (`_hex_to_ass_color`,
`_build_header`) and one call-site update in `main.py`. No new fields,
no new payload shape, no coordination needed with `RenderProcessor`.

**Hex-to-ASS conversion fails closed to the platform default, never to a
render failure.** A malformed or missing `brandColor` (the overwhelming
majority of orgs, who haven't set one) falls back to the original
hardcoded yellow rather than raising — a cosmetic branding miss must
never be the reason a Short fails to render.

## Known follow-ups

- **Custom domain per client** (`client.brand.com` via CNAME) — DNS/Vercel
  infrastructure work, not application code.
- **Stable public logo URLs for email** — today's presign-at-render-time
  approach works for the app shell and Short overlays but is
  intentionally skipped for emails (see rationale above); revisit once
  custom domains / a public CDN path exists.
- **Branding on the invite email, weekly digest, and other system mail
  that fires before `NotificationsService.send()`'s standard path** —
  `notifyTeamInvite()` still sends unbranded; low priority since it's a
  one-time, pre-membership touchpoint.
- **Consolidated agency billing** — child orgs bill independently.
- **Per-API-key rate limiting** — the `external` throttle bucket is
  per-IP (Nest's default), not per-key.
- **No scoped API-key permissions** — a key can do everything the
  `API_ACCESS`-gated public routes expose.
- **No `ipAddress` on any audit entry yet.**
- **No audit log export** (CSV/JSON) of a filtered view.
- **No real-time audit log updates.**
- **Analytics API call volume at scale** — still one call per Short per
  day (§17.1's cost note).

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Custom domains + stable public logo URLs** | Unblocks branded emails and is the last major piece of §15.2's white-label promise. | §15.2 |
| 2 | **Analytics API call batching** | Collapse per-Short daily calls into batched multi-video requests before Short volume makes the current approach costly. | §17 follow-up |
| 3 | **Per-API-key rate limiting + scoping** | Move the `external` bucket from per-IP to per-key, and add read-only vs. write key scopes before the public API surface grows further. | §15.2 follow-up |

---

## PR 10 — Agency White-Label Features (§15.2, Phase 6)

`packages/shared/src/feature-flags.ts` (`FLAGS`) + `FeatureGuard`;
`AgencyModule` (client sub-orgs + dashboard); `ApiKeysModule` +
`ApiKeyGuard` + `PublicApiModule`; `POST /videos/bulk-import`;
`Organization.parentOrganizationId` + `ApiKey` model.

To exercise Agency-gated features (`/agency`, `/settings/api-keys`, and
now PR 12's white-label footer removal), bump the demo org:

```sql
UPDATE "Organization" SET plan = 'AGENCY', "quotaShortsPerMonth" = 999999
WHERE slug = 'demo-org';
```

Then log out and back in — plan is baked into the JWT at issue time
(§9.1), so a fresh access token is required for anything gated by
`FeatureGuard`. (Branding's own white-label check in PR 12 reads live
from `GET /organizations/branding`, not the JWT, so *that* one flips
without a relogin.)

## PR 11 — Audit Log Admin UI (§9.4 follow-up)

`AuditLogService.query()` (cursor pagination, filters) +
`AuditLogService.distinctActions()`; `AuditLogController`
(`@Roles(ADMIN, OWNER)`); `packages/shared/src/audit.ts`; `apps/web`
`/settings/audit-log`. No schema changes.

## PR 12 — Full White-Label Branding Pass (§15.2)

### What this ships

- `StorageService.getPresignedUploadUrl()` — the first *write* presigned
  URL in the codebase (every prior use was `GetObjectCommand`-only).
- `OrganizationsService`: `updateBranding()` extended to accept
  `brandColor` / `logoS3Key`; new `requestLogoUploadUrl()` and
  `getPublicBranding()`.
- `OrganizationsController`: `GET /organizations/branding` (any
  authenticated role), `POST /organizations/branding/logo-upload-url`
  (Admin+), `PUT /organizations/branding` (Admin+, extended DTO).
- `EmailService`: every outbound email now renders inside a branded HTML
  wrapper (logo-or-org-name header, brand-colored CTA button,
  conditional "Powered by" footer).
- `NotificationsService.brandingFor()`: resolves an org's branding once
  per `send()` call and threads it into `EmailService`.
- `services/render-worker/caption_generator.py`: `_hex_to_ass_color()` +
  `_build_header()` — the word-pop caption highlight color now comes from
  the org's `brandColor` instead of a hardcoded yellow. `main.py` passes
  `job.brandColor` through (the field already existed in the job payload,
  sent by `RenderProcessor` since the original render implementation —
  this PR is the first thing that actually reads it).
- `packages/shared/src/branding.ts`: `OrganizationBranding` type +
  `DEFAULT_BRAND_COLOR`, exported from the shared package barrel.
- `apps/web`: `useBranding()` hook, `<PoweredByFooter/>` component,
  `/settings/branding` page (logo upload + color picker + white-label
  status card), app-shell sidebar now shows the org's logo/name.
- Tests: `apps/api/test/organizations-branding.test.js` (branding CRUD,
  upload-URL scoping, plan-gated `whiteLabelEnabled`);
  `services/render-worker/test_caption_generator.py` (hex→ASS color
  conversion, including malformed-input fallback).

### Packaging

PR 12 is delivered as a complete, drop-in file set — **every file listed
above is a full replacement of its target, never a diff or patch** — laid
out in a directory tree that mirrors the monorepo exactly:

```
apps/api/src/storage/storage.service.ts
apps/api/src/organizations/organizations.service.ts
apps/api/src/organizations/organizations.controller.ts
apps/api/src/organizations/organizations.module.ts
apps/api/src/organizations/dto/update-organization-branding.dto.ts
apps/api/src/organizations/dto/request-logo-upload.dto.ts
apps/api/src/notifications/email.service.ts
apps/api/src/notifications/notifications.service.ts
apps/api/test/organizations-branding.test.js
packages/shared/src/branding.ts
packages/shared/src/index.ts
services/render-worker/caption_generator.py
services/render-worker/main.py
services/render-worker/test_caption_generator.py
apps/web/lib/branding.ts
apps/web/components/powered-by-footer.tsx
apps/web/app/(app)/settings/branding/page.tsx
apps/web/app/(app)/layout.tsx
```

See `SETUP_INSTRUCTIONS_PR12.md` for the exact copy/apply steps.

### Deliberately deferred

Custom domains, stable public logo URLs for email, branding on
pre-membership emails (team invite) — see "Known follow-ups."

### Migration

**None.** `Organization.logoS3Key` and `Organization.brandColor` have
existed since the very first migration (§5.1) — this PR is pure
application code that finally reads and writes them everywhere they
matter.
