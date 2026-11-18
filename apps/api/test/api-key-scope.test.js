const test = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException, UnauthorizedException } = require('@nestjs/common');
const { ApiKeyScopeGuard } = require('../dist/common/guards/api-key-scope.guard.js');
const { ApiKeyThrottlerGuard } = require('../dist/common/guards/api-key-throttler.guard.js');
const { ApiKeyGuard } = require('../dist/common/guards/api-key.guard.js');

// PR 14 (§15.2 follow-up: per-API-key rate limiting + scoping)

function makeScopeContext(apiKeyScope) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ apiKeyScope }) }),
  };
}
function makeReflector(requiredScope) {
  return { getAllAndOverride: () => requiredScope };
}

test('ApiKeyScopeGuard allows any key through when no @RequireScope() is set', () => {
  const guard = new ApiKeyScopeGuard(makeReflector(undefined));
  assert.equal(guard.canActivate(makeScopeContext('READ_ONLY')), true);
});

test('ApiKeyScopeGuard blocks a READ_ONLY key from a READ_WRITE-required route', () => {
  const guard = new ApiKeyScopeGuard(makeReflector('READ_WRITE'));
  assert.throws(() => guard.canActivate(makeScopeContext('READ_ONLY')), ForbiddenException);
});

test('ApiKeyScopeGuard allows a READ_WRITE key through a READ_WRITE-required route', () => {
  const guard = new ApiKeyScopeGuard(makeReflector('READ_WRITE'));
  assert.equal(guard.canActivate(makeScopeContext('READ_WRITE')), true);
});

test('ApiKeyScopeGuard allows a READ_WRITE key through even a READ_ONLY-required route', () => {
  const guard = new ApiKeyScopeGuard(makeReflector('READ_ONLY'));
  assert.equal(guard.canActivate(makeScopeContext('READ_WRITE')), true);
});

test('ApiKeyGuard attaches organizationId, apiKeyId, and apiKeyScope from the resolved key record', async () => {
  const apiKeys = {
    resolve: async () => ({ id: 'key-1', organizationId: 'org-1', scope: 'READ_ONLY' }),
  };
  const guard = new ApiKeyGuard(apiKeys);
  const req = { headers: { authorization: 'Bearer sk_live_abc' } };
  const context = { switchToHttp: () => ({ getRequest: () => req }) };

  const result = await guard.canActivate(context);

  assert.equal(result, true);
  assert.equal(req.organizationId, 'org-1');
  assert.equal(req.apiKeyId, 'key-1');
  assert.equal(req.apiKeyScope, 'READ_ONLY');
});

test('ApiKeyGuard rejects a missing or malformed Authorization header', async () => {
  const guard = new ApiKeyGuard({ resolve: async () => null });
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };

  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});

test('ApiKeyThrottlerGuard.getTracker hashes a bearer sk_live_ key into an "apikey:" tracker, not the raw key', async () => {
  const guard = new ApiKeyThrottlerGuard([{ name: 'default', limit: 1, ttl: 1000 }], {}, {});
  const tracker = await guard.getTracker({ headers: { authorization: 'Bearer sk_live_abc123' } });
  assert.match(tracker, /^apikey:[0-9a-f]{64}$/);
  assert.ok(!tracker.includes('sk_live_abc123'));
});

test('ApiKeyThrottlerGuard.getTracker produces the same tracker for the same key on repeat calls', async () => {
  const guard = new ApiKeyThrottlerGuard([{ name: 'default', limit: 1, ttl: 1000 }], {}, {});
  const t1 = await guard.getTracker({ headers: { authorization: 'Bearer sk_live_samekey' } });
  const t2 = await guard.getTracker({ headers: { authorization: 'Bearer sk_live_samekey' } });
  assert.equal(t1, t2);
});

test('ApiKeyThrottlerGuard.getTracker produces different trackers for different keys', async () => {
  const guard = new ApiKeyThrottlerGuard([{ name: 'default', limit: 1, ttl: 1000 }], {}, {});
  const t1 = await guard.getTracker({ headers: { authorization: 'Bearer sk_live_keyone' } });
  const t2 = await guard.getTracker({ headers: { authorization: 'Bearer sk_live_keytwo' } });
  assert.notEqual(t1, t2);
});

test('ApiKeyThrottlerGuard.getTracker falls back to IP-based tracking for non-API-key requests', async () => {
  const guard = new ApiKeyThrottlerGuard([{ name: 'default', limit: 1, ttl: 1000 }], {}, {});
  const tracker = await guard.getTracker({ headers: {}, ip: '203.0.113.5' });
  assert.equal(tracker, '203.0.113.5');
});
