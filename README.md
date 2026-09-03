# YouTube Shorts Automation & SaaS Platform

This repo is the implementation of the roadmap/SRS/architecture docs.
Status below reflects two combined milestones shipped back to back:

- **PR 10 — Agency White-Label Features** (§15.2, Phase 6): client
  sub-organizations, an agency health/usage dashboard, org-scoped API
  keys with a minimal public REST API, CSV bulk import — all behind a
  real plan-gated feature-flag system (§20.7) that previously only
  existed as a code comment in the planning doc.
- **PR 11 — Audit Log Admin UI** (§9.4 follow-up): the compliance trail
  PR 9 started writing and PR 10 extended is now actually readable from
  the product — filterable by action, actor, resource, and date range,
  cursor-paginated — instead of only via Prisma Studio or raw SQL.

> Paste URL → DB row → job dispatched → video downloaded & audio
> extracted → transcribed with word timestamps → GPT-4o scores candidate
> clips → human approves one → render-worker crops/captions/encodes it →
> "Shorts ready" notification → human approves → quota check (§13.2) →
> schedule → publish-worker uploads it to YouTube → "Short published"
> notification → daily analytics sync → Stripe subscription drives
> plan/quota → 80%/95% quota or payment-failure alerts → admins manage
> teammates from `/settings/users` → **and now: an Agency-plan org can
> create client sub-organizations from `/agency`, see a live
> health/usage dashboard across every client it manages, issue an
> org-scoped API key from `/settings/api-keys` for external tools to
> call `POST /api/v1/public/v1/videos` directly, and bulk-import a CSV
> of YouTube URLs into a channel's queue in one request — with every one
> of these actions (`agency.client_created`, `apikey.created`,
> `apikey.revoked`), plus everything PR 9 already logs, now visible,
> filterable, and paginated on `/settings/audit-log`.**

## What's built

| Layer | Status |
| --- | --- |
| Monorepo, DB schema, auth, tenant isolation, RBAC | ✅ |
| Full pipeline (import → download → transcribe → clip-score → render → publish) | ✅ |
| WebSockets, Analytics + daily sync, Stripe billing + quota | ✅ |
| Notifications (email/in-app/Slack), team invites, `/settings/users` | ✅ |
| `AuditLogService.record()` wired into every destructive action | ✅ |
| Named throttle buckets, `InternalSecretGuard`, tenant-isolation regression suite | ✅ |
| `packages/shared/feature-flags.ts` (`FLAGS`) — plan-gated feature policy, §20.7 finally in code | ✅ **PR 10** |
| `apps/api` — **`FeatureGuard` / `@Feature(...)`** — generic plan gate, reads `req.user.plan` off the JWT, no DB hit | ✅ **PR 10** |
| `apps/api` — **`AgencyModule`**: `POST /agency/clients`, `GET /agency/clients`, `GET /agency/dashboard` (per-client usage + green/amber/red activity health) | ✅ **PR 10** |
| `apps/api` — **`ApiKeysModule`**: `POST/GET/DELETE /organizations/api-keys` — org-scoped keys, one-time raw-key reveal, sha256-hashed at rest | ✅ **PR 10** |
| `apps/api` — **`PublicApiModule`** (`ApiKeyGuard`): `POST/GET /api/v1/public/v1/videos` — external integrations authenticate with `Authorization: Bearer sk_live_...` instead of a user JWT | ✅ **PR 10** |
| `apps/api` — **`POST /videos/bulk-import`** — CSV-of-URLs bulk import, gated `BULK_IMPORT` (excludes Starter), one bad row never aborts the batch | ✅ **PR 10** |
| `Organization.parentOrganizationId` self-relation, `ApiKey` model/migration | ✅ **PR 10** |
| `apps/web` — `/agency` dashboard, `/settings/api-keys` | ✅ **PR 10** |
| `apps/api` — **`AuditLogService.query()`**: cursor-paginated, filterable by action/userId/resourceType/resourceId/date range, org-scoped | ✅ **PR 11** |
| `apps/api` — **`AuditLogController`** (`GET /audit-log`, `GET /audit-log/actions`), `@Roles(ADMIN, OWNER)` | ✅ **PR 11** |
| `packages/shared/src/audit.ts` — `AUDIT_ACTIONS`/`AuditLogRow`/`AuditLogPage` shared between API and web | ✅ **PR 11** |
| `apps/web` — **`/settings/audit-log`**: filter bar (action, date range) + paginated table + "Load more" | ✅ **PR 11** |
| Tenant-isolation regression case for the audit log itself | ✅ **PR 11** |
| Custom domain per client (`client.brand.com`) | ⏳ not started — DNS/Vercel infra, out of scope for app code |
| Full "Powered by" removal across UI/emails/overlays | ⏳ not started |
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
# No new env vars for PR 10 or PR 11 — API keys are generated server-side.

pnpm --filter @shorts/db generate
pnpm --filter @shorts/db migrate:dev   # picks up 20260818090000_add_agency_and_api_keys
pnpm --filter @shorts/db seed

stripe listen --forward-to localhost:3001/api/v1/billing/webhook   # only if testing billing

pnpm dev
```

For the exact copy/apply steps for this combined change (as opposed to a
fresh clone), see **`SETUP_INSTRUCTIONS.md`** in this package.

## Trying it out

The seeded demo org (`admin@dev.local` / `password123`) is on `STARTER`
and the demo admin is `OWNER`, so:

- `/settings/audit-log` (PR 11) is visible immediately — Admin+ only, no
  plan gate. Trigger a few of the actions that already write to it
  (reject a clip, disconnect a channel, cancel a schedule, change a
  teammate's role) and they'll show up filterable by action/date.
- `/agency` and `/settings/api-keys` (PR 10) are plan-gated to Agency+.
  Bump the demo org first:

  ```sql
  -- In psql or Prisma Studio:
  UPDATE "Organization" SET plan = 'AGENCY', "quotaShortsPerMonth" = 999999
  WHERE slug = 'demo-org';
  ```

  Then log out and back in — plan is baked into the JWT at issue time
  (§9.1), so a fresh access token is required. After that:

  1. Visit `/agency` → create a client workspace → it appears in the
     dashboard with `health: red` until it has activity.
  2. Visit `/settings/api-keys` → create a key → copy the one-time
     revealed `sk_live_...` value.
  3. `curl -X POST http://localhost:3001/api/v1/public/v1/videos -H "Authorization: Bearer sk_live_..." -H "Content-Type: application/json" -d '{"youtubeUrl":"https://youtube.com/watch?v=dQw4w9WgXcQ","channelId":"<a channel id>"}'`
  4. On `/videos`, use bulk import (`POST /videos/bulk-import`) to import
     several URLs in one request — each row succeeds/fails independently.
  5. Check `/settings/audit-log` filtered to `agency.client_created` /
     `apikey.created` / `apikey.revoked` to see the new action types.

## Why these specific choices

**A child org is a fully independent `Organization` row, not a special
case.** `parentOrganizationId` is the only new field — every existing
`findFirst({ where: { id, organizationId } })` guarantee, RBAC check, and
quota rule from §9/§13 applies to a client workspace unchanged. The
alternative (a "lite" org type with special-cased permission logic) would
have meant re-auditing every tenant-isolation assumption in the codebase
for a second org shape.

**Billing is NOT inherited from parent to child in this version.** A
child starts on STARTER with its own (currently nominal) quota and would
need its own Stripe subscription to upgrade. Consolidated agency billing
is flagged as a follow-up rather than guessed at — it has real product
and pricing implications (§13.1) that deserve their own design pass.

**`FeatureGuard` reads `plan` off the JWT, not the DB.** Same tradeoff
already accepted for RBAC (`RolesGuard` also reads `req.user.role` from
the token): zero extra DB round-trips per request, at the cost of up to a
15-minute staleness window after a plan change (the access-token TTL).
`assertQuotaAvailable()` and `checkAndNotifyThreshold()` already re-read
the org row directly wherever money or quota correctness actually
matters, so this is an acceptable window for a feature-visibility gate.

**API keys are a separate trust boundary from user JWTs, not an
extension of them.** `ApiKeyGuard` is deliberately not folded into
`JwtAuthGuard` — external callers have no user session, no role, no org
room to join over WebSocket. Same shape as the Stripe-webhook /
internal-worker trust boundaries already in §9.4.

**Cursor pagination for the audit log, not offset.** §8.1 already
establishes cursor-based pagination as this API's convention for large,
append-only sets — the audit log is the purest example of that shape
(strictly growing, queried newest-first). Offset pagination degrades in
two ways here: page N gets slower as N grows, and a row inserted between
two page loads can shift results across a page boundary the user won't
notice. Cursor-on-`id` sidesteps both.

**Audit log is Admin+ only, not "every authenticated role."** Analytics
(§9.2's one row where all four roles pass) is read-only business data;
the audit log is closer to billing and team management in sensitivity —
it can surface who got deactivated, whose role changed and to what,
which channel got disconnected and by whom. Restricting it to the same
tier as those other sensitive views was a deliberate choice.

## Known follow-ups

- **Custom domain per client** (`client.brand.com` via CNAME) — DNS/Vercel
  infrastructure work, not application code.
- **Full "Powered by" removal** — the branding fields (`logoS3Key`,
  `brandColor`) have existed since the original schema, but nothing in
  the UI/emails/Short overlays actually conditions on them yet.
- **Consolidated agency billing** — child orgs bill independently.
- **Per-API-key rate limiting** — the `external` throttle bucket is
  per-IP (Nest's default), not per-key.
- **No scoped API-key permissions** — a key can do everything the
  `API_ACCESS`-gated public routes expose; no read-only/write-only split.
- **No `ipAddress` on any audit entry yet** — would need `@Req() req`
  threaded through every audit-logged controller method.
- **No audit log export** (CSV/JSON) of a filtered view.
- **No real-time audit log updates** — manual-refresh table, not
  WebSocket-driven; audit review is inherently retrospective.
- **Analytics API call volume at scale** — still one call per Short per
  day (§17.1's cost note).

## Next up

| Priority | What | Why it's next | Spec ref |
| --- | --- | --- | --- |
| 1 | **Full white-label branding pass** | Logo/color have been stored since the original schema; wire them into the UI shell, emails, and Short overlays, and strip "Powered by" everywhere for Agency+ orgs. | §15.2 |
| 2 | **Analytics API call batching** | Collapse per-Short daily calls into batched multi-video requests before Short volume makes the current approach costly. | §17 follow-up |
| 3 | **Per-API-key rate limiting + scoping** | Move the `external` bucket from per-IP to per-key, and add read-only vs. write key scopes before the public API surface grows further. | §15.2 follow-up |

---

## PR 10 — Agency White-Label Features (§15.2, Phase 6)

### What this ships

- `packages/shared/src/feature-flags.ts` (`FLAGS`) + `apps/api`'s
  `FeatureGuard`/`@Feature(...)` — §20.7's plan-gating policy.
- `AgencyModule` — `createClientOrg()` (STARTER child under the caller's
  org, slug-collision-safe, audit-logged) and `dashboard()` (per-client
  usage + green/amber/red activity health).
- `ApiKeysModule` + `ApiKeyGuard` + `PublicApiModule` — one-time-reveal,
  sha256-hashed-at-rest API keys; `POST/GET /api/v1/public/v1/videos`
  authenticated by key instead of JWT.
- `POST /videos/bulk-import` — CSV-of-URLs import, per-row independent
  success/failure.
- New migration `20260818090000_add_agency_and_api_keys` — nullable
  self-relation column + one new table, safe to run live.
- `AuditAction` extended with `agency.client_created`, `apikey.created`,
  `apikey.revoked`.

### Deliberately deferred

Custom domains, full white-label UI wiring, consolidated agency billing,
per-key scoping, and per-key rate limiting — see "Known follow-ups."

### Migration

`20260818090000_add_agency_and_api_keys` — expand-only (§20.5): one
nullable column on `Organization`, one new enum, one new table.

---

## PR 11 — Audit Log Admin UI (§9.4 follow-up)

### What this ships

- `AuditLogService.query()` — cursor-paginated, org-scoped, filterable by
  action/actor/resource/date range.
- `AuditLogService.distinctActions()` — server-confirmed action list.
- `AuditLogController` — `GET /audit-log`, `GET /audit-log/actions`,
  `@Roles(ADMIN, OWNER)`.
- `packages/shared/src/audit.ts` — shared action list + row/page types.
- `apps/web` `/settings/audit-log` — filter bar, table, cursor-driven
  "Load more."
- New tenant-isolation regression case: an org's audit log is invisible
  to every other org, even with zero filters applied.

### Deliberately deferred

`ipAddress` capture, CSV/JSON export, and real-time updates — see
"Known follow-ups."

### Migration

None. PR 11 is pure application code against the existing `AuditLog`
table.
