const test = require('node:test');
const assert = require('node:assert/strict');
const { HttpException } = require('@nestjs/common');
const { QuotaService } = require('../dist/billing/quota.service.js');

// PR 7 (§15 Notifications): QuotaService gained a `notifications`
// constructor dependency (NotificationsService), injected after prisma.
// This stub matches NotificationsService's public surface used by
// QuotaService — same "stub the boundary, test the logic" style as
// noopAnalytics in publish.processor.test.js.
function makeNotifications(onNotify) {
  return {
    notify: async (type, organizationId, metadata) => {
      onNotify?.(type, organizationId, metadata);
    },
  };
}

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
  const service = new QuotaService(
    makePrisma({ id: 'org-1', plan: 'STARTER', quotaShortsPerMonth: 50 }, 49),
    makeNotifications(),
  );
  await service.assertQuotaAvailable('org-1'); // should not throw
});

test('assertQuotaAvailable throws 402 QUOTA_EXCEEDED at the limit (§18.2: 51st Short on Starter)', async () => {
  let notified = null;
  const service = new QuotaService(
    makePrisma({ id: 'org-1', plan: 'STARTER', quotaShortsPerMonth: 50 }, 50),
    makeNotifications((type) => { notified = type; }),
  );

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
  // §15.1 "Quota exceeded" notification fires alongside the 402.
  assert.equal(notified, 'QUOTA_EXCEEDED');
});

test('assertQuotaAvailable still throws the correct 402 even if the notification channel itself fails', async () => {
  const service = new QuotaService(
    makePrisma({ id: 'org-1', plan: 'STARTER', quotaShortsPerMonth: 50 }, 50),
    { notify: async () => { throw new Error('email provider down'); } },
  );

  await assert.rejects(
    () => service.assertQuotaAvailable('org-1'),
    (err) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), 402);
      return true;
    },
  );
});

test('assertQuotaAvailable never gates AGENCY plans regardless of usage', async () => {
  const service = new QuotaService(
    makePrisma({ id: 'org-2', plan: 'AGENCY', quotaShortsPerMonth: 999_999 }, 5_000),
    makeNotifications(),
  );
  await service.assertQuotaAvailable('org-2'); // should not throw
});

test('assertQuotaAvailable never gates ENTERPRISE plans regardless of usage', async () => {
  const service = new QuotaService(
    makePrisma({ id: 'org-3', plan: 'ENTERPRISE', quotaShortsPerMonth: 999_999 }, 50_000),
    makeNotifications(),
  );
  await service.assertQuotaAvailable('org-3'); // should not throw
});

test('usageThisMonth reports unlimited: true for Agency/Enterprise', async () => {
  const service = new QuotaService(
    makePrisma({ id: 'org-4', plan: 'AGENCY', quotaShortsPerMonth: 999_999 }, 10),
    makeNotifications(),
  );
  const result = await service.usageThisMonth('org-4');
  assert.equal(result.unlimited, true);
  assert.equal(result.used, 10);
});

// PR 7: checkAndNotifyThreshold — §15.1 "Quota warning 80%/95%"

test('checkAndNotifyThreshold fires QUOTA_WARNING when crossing 80%', async () => {
  let firedPct = null;
  // 40/50 = 80% exactly; (40-1)/50 = 78% < 80% <= 80% -> fires
  const service = new QuotaService(
    makePrisma({ id: 'org-5', plan: 'STARTER', quotaShortsPerMonth: 50 }, 40),
    makeNotifications((type, orgId, meta) => { firedPct = meta.pct; }),
  );
  await service.checkAndNotifyThreshold('org-5');
  assert.equal(firedPct, 80);
});

test('checkAndNotifyThreshold fires 95% (not 80%) when both thresholds are crossed in one jump', async () => {
  // e.g. quota lowered via downgrade mid-month: 48/50 = 96%, previous 47/50 = 94%
  let firedPct = null;
  const service = new QuotaService(
    makePrisma({ id: 'org-6', plan: 'STARTER', quotaShortsPerMonth: 50 }, 48),
    makeNotifications((type, orgId, meta) => { firedPct = meta.pct; }),
  );
  await service.checkAndNotifyThreshold('org-6');
  assert.equal(firedPct, 95);
});

test('checkAndNotifyThreshold does not re-fire once already past a threshold', async () => {
  // 42/50 = 84%; (42-1)/50 = 82% -- both already >= 80%, so no new crossing
  let fired = false;
  const service = new QuotaService(
    makePrisma({ id: 'org-7', plan: 'STARTER', quotaShortsPerMonth: 50 }, 42),
    makeNotifications(() => { fired = true; }),
  );
  await service.checkAndNotifyThreshold('org-7');
  assert.equal(fired, false);
});

test('checkAndNotifyThreshold never fires for unlimited plans', async () => {
  let fired = false;
  const service = new QuotaService(
    makePrisma({ id: 'org-8', plan: 'AGENCY', quotaShortsPerMonth: 999_999 }, 999_999),
    makeNotifications(() => { fired = true; }),
  );
  await service.checkAndNotifyThreshold('org-8');
  assert.equal(fired, false);
});
