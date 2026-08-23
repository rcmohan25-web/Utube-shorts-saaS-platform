const test = require('node:test');
const assert = require('node:assert/strict');
const { UnauthorizedException } = require('@nestjs/common');
const { InternalSecretGuard } = require('../dist/common/guards/internal-secret.guard.js');

function makeContext(headers) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  };
}

test('InternalSecretGuard allows a request whose header matches API_INTERNAL_SECRET exactly', () => {
  process.env.API_INTERNAL_SECRET = 'test-secret-value';
  const guard = new InternalSecretGuard();

  const result = guard.canActivate(makeContext({ 'x-internal-secret': 'test-secret-value' }));

  assert.equal(result, true);
});

test('InternalSecretGuard rejects a request with a wrong secret', () => {
  process.env.API_INTERNAL_SECRET = 'test-secret-value';
  const guard = new InternalSecretGuard();

  assert.throws(
    () => guard.canActivate(makeContext({ 'x-internal-secret': 'wrong-value-xx' })),
    UnauthorizedException,
  );
});

test('InternalSecretGuard rejects a request with a missing header', () => {
  process.env.API_INTERNAL_SECRET = 'test-secret-value';
  const guard = new InternalSecretGuard();

  assert.throws(() => guard.canActivate(makeContext({})), UnauthorizedException);
});

// PR 9: rejects on a differently-sized secret before ever reaching
// timingSafeEqual (which throws on mismatched buffer lengths rather than
// returning false) — this is the fail-safe branch that keeps that internal
// implementation detail from ever surfacing as an unhandled RangeError.
test('InternalSecretGuard rejects a header of a different length than the configured secret', () => {
  process.env.API_INTERNAL_SECRET = 'test-secret-value';
  const guard = new InternalSecretGuard();

  assert.throws(
    () => guard.canActivate(makeContext({ 'x-internal-secret': 'short' })),
    UnauthorizedException,
  );
});

// PR 9: fail CLOSED, not open, when the env var itself is unset — this is
// the change from the pre-PR-9 guard, which would also reject an empty
// string via `!provided`, but did not distinguish "misconfigured server"
// from "wrong client secret" in its error path.
test('InternalSecretGuard fails closed when API_INTERNAL_SECRET is not configured', () => {
  delete process.env.API_INTERNAL_SECRET;
  const guard = new InternalSecretGuard();

  assert.throws(
    () => guard.canActivate(makeContext({ 'x-internal-secret': 'anything' })),
    UnauthorizedException,
  );
});
