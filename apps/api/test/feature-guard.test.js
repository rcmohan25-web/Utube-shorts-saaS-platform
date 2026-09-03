const test = require('node:test');
const assert = require('node:assert/strict');
const { ForbiddenException } = require('@nestjs/common');
const { FeatureGuard } = require('../dist/common/guards/feature.guard.js');

function makeContext(plan) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: { plan } }) }),
  };
}
function makeReflector(flag) {
  return { getAllAndOverride: () => flag };
}

test('FeatureGuard allows any plan through when no @Feature() is set', () => {
  const guard = new FeatureGuard(makeReflector(undefined));
  assert.equal(guard.canActivate(makeContext('STARTER')), true);
});

test('FeatureGuard blocks a STARTER org from an Agency-gated route', () => {
  const guard = new FeatureGuard(makeReflector('API_ACCESS'));
  assert.throws(() => guard.canActivate(makeContext('STARTER')), ForbiddenException);
});

test('FeatureGuard allows an AGENCY org through an Agency-gated route', () => {
  const guard = new FeatureGuard(makeReflector('API_ACCESS'));
  assert.equal(guard.canActivate(makeContext('AGENCY')), true);
});
