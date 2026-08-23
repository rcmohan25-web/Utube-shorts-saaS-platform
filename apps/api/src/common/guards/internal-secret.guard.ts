import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';

// Used on worker→API callback routes (e.g. PATCH /videos/:id/status).
// These are NOT user-authenticated — Python workers call back with a shared
// secret, per §12.1 API_INTERNAL_SECRET. Keep this guard OUT of the global
// JWT guard chain by registering the route with @Public() and applying
// this guard directly.
//
// PR 9 (Security Hardening, §19.1): two changes from the original version —
//   1. Fail CLOSED if API_INTERNAL_SECRET isn't configured. The original
//      implementation's `!provided || provided !== process.env...` would
//      throw UnauthorizedException on an empty-string secret too (falsy),
//      but if the env var were ever set to something unexpected upstream
//      (e.g. accidentally unset mid-deploy) this makes the failure mode
//      explicit rather than relying on the equality check alone.
//   2. Constant-time comparison via crypto.timingSafeEqual(). A naive
//      `!==` string comparison short-circuits at the first mismatched
//      character, which leaks timing information proportional to the
//      matching prefix length — narrowing a brute-force search for the
//      secret. This guard sits on public, unauthenticated-by-JWT routes,
//      so it's worth the extra care.
@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const provided = req.headers['x-internal-secret'];
    const expected = process.env.API_INTERNAL_SECRET;

    if (!expected) {
      throw new UnauthorizedException('API_INTERNAL_SECRET is not configured');
    }
    if (typeof provided !== 'string' || provided.length !== expected.length) {
      // Reject on length mismatch before touching timingSafeEqual, which
      // throws (rather than returning false) on differently-sized buffers.
      // The length check itself doesn't leak anything useful — the expected
      // format is not a secret.
      throw new UnauthorizedException('Invalid internal secret');
    }
    if (!timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
      throw new UnauthorizedException('Invalid internal secret');
    }
    return true;
  }
}
