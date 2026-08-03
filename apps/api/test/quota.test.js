const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpException } = require('@nestjs/common');
const { QuotaService } = require('../dist/billing/quota.service.js');

function makePrisma(org, usedCount) {
  return {
    client: {
      organization: {
        findUnique: async () => org,
        findUniqueOrThrow: async () => org,
      },
      usageEvent: {
        count: async () => usedCount,
      },
    },
  };
}

test('assertQuotaAvailable allows a Starter org under quota', async () => {
  const service = new QuotaService(makePrisma({ id: 'org-1', plan: 'STARTER', quotaShortsPerMonth: 50 }, 49));
  await service.assertQuotaAvailable('org-1'); // should not throw
});

test('assertQuotaAvailable throws 402 QUOTA_EXCEEDED at the limit (§18.2: 51st Short on Starter)', async () => {
  const service = new QuotaService(makePrisma({ id: 'org-1', plan: 'STARTER', quotaShortsPerMonth: 50 }, 50));

  await assert.rejects(
    () => service.assertQuotaAvailable('org-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), 402);
      const body = err.getResponse();
      assert.equal(body.code, 'QUOTA_EXCEEDED');
      return true;
    },
  );
});

test('assertQuotaAvailable never gates AGENCY plans regardless of usage', async () => {
  const service = new QuotaService(makePrisma({ id: 'org-2', plan: 'AGENCY', quotaShortsPerMonth: 999_999 }, 5_000));
  await service.assertQuotaAvailable('org-2'); // should not throw
});

test('assertQuotaAvailable never gates ENTERPRISE plans regardless of usage', async () => {
  const service = new QuotaService(makePrisma({ id: 'org-3', plan: 'ENTERPRISE', quotaShortsPerMonth: 999_999 }, 50_000));
  await service.assertQuotaAvailable('org-3'); // should not throw
});

test('usageThisMonth reports unlimited: true for Agency/Enterprise', async () => {
  const service = new QuotaService(makePrisma({ id: 'org-4', plan: 'AGENCY', quotaShortsPerMonth: 999_999 }, 10));
  const result = await service.usageThisMonth('org-4');
  assert.equal(result.unlimited, true);
  assert.equal(result.used, 10);
});
