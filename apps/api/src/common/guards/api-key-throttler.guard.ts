import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

// PR 14 (§15.2 follow-up: per-API-key rate limiting). Replaces the plain
// ThrottlerGuard as the global APP_GUARD. For requests carrying a
// `sk_live_...` bearer token (the public API, §15.2), the throttle
// tracker is a hash of the raw key rather than the caller's IP — so two
// integrations sharing an egress IP (common behind a shared proxy/NAT)
// get independent limits, and a single caller can't dodge its own limit
// by rotating IPs. Every other request (all JWT-authenticated routes)
// falls back to the base class's IP-based tracking, so behavior is
// unchanged for the rest of the app.
//
// Deliberately does NOT depend on ApiKeyGuard having already run and
// attached req.apiKeyId: ThrottlerGuard is a global guard (APP_GUARD),
// and Nest always executes global guards before any route-level
// @UseGuards() guard — including ApiKeyGuard on PublicApiController. If
// this guard tried to read req.apiKeyId, it would always see undefined.
// Re-parsing the bearer token here — hashing it, never resolving it to a
// DB row — keeps this guard fast (no DB call on every throttle check) and
// completely independent of guard execution order. ApiKeyGuard still
// does the real authentication/authorization; this guard only decides
// *which bucket* a request's rate limit counts against.
@Injectable()
export class ApiKeyThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const header = req?.headers?.['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer sk_live_')) {
      const rawKey = header.slice(7);
      // Hash rather than using the raw key as the tracker string: this
      // value can end up in the throttler's storage keys (in-memory or
      // Redis, depending on deployment), and a secret shouldn't live
      // anywhere in plaintext-adjacent form, even transient rate-limit
      // bookkeeping.
      const hash = createHash('sha256').update(rawKey).digest('hex');
      return `apikey:${hash}`;
    }
    return super.getTracker(req);
  }
}
