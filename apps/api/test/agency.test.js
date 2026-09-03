const test = require('node:test');
const assert = require('node:assert/strict');
const { AgencyService } = require('../dist/agency/agency.service.js');

function makeAuditLog(onRecord) {
  return { record: async (entry) => { onRecord?.(entry); } };
}

function makePrisma(overrides = {}) {
  return {
    client: {
      organization: {
        findUnique: async () => ({ id: 'org-parent', slug: 'acme-agency' }),
        create: async (args) => ({ id: 'org-child-1', ...args.data }),
        findMany: async () => [],
        ...overrides.organization,
      },
      usageEvent: { count: async () => 0, ...overrides.usageEvent },
      channel: { count: async () => 0, ...overrides.channel },
      video: { findFirst: async () => null, ...overrides.video },
    },
  };
}

test('createClientOrg creates a STARTER-plan child scoped to the parent and records an AuditLog entry', async () => {
  const recorded = [];
  const prisma = makePrisma();
  const service = new AgencyService(prisma, makeAuditLog((e) => recorded.push(e)));

  const child = await service.createClientOrg({ name: 'Client One' }, 'org-parent', 'user-1');

  assert.equal(child.parentOrganizationId, 'org-parent');
  assert.equal(child.plan, 'STARTER');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].action, 'agency.client_created');
  assert.equal(recorded[0].organizationId, 'org-parent');
});

test('createClientOrg avoids a slug collision by appending a numeric suffix', async () => {
  let calls = 0;
  const prisma = makePrisma({
    organization: {
      findUnique: async ({ where }) => {
        if (where.id) return { id: 'org-parent', slug: 'acme-agency' };
        calls += 1;
        return calls === 1 ? { id: 'existing' } : null;
      },
      create: async (args) => ({ id: 'org-child-2', ...args.data }),
    },
  });
  const service = new AgencyService(prisma, makeAuditLog());

  const child = await service.createClientOrg({ name: 'Client Two' }, 'org-parent', 'user-1');

  assert.match(child.slug, /-1$/);
});

test('dashboard aggregates per-client usage and totals across all children', async () => {
  const prisma = makePrisma({
    organization: {
      findMany: async () => [
        { id: 'child-1', name: 'Client A', slug: 'a', plan: 'STARTER', quotaShortsPerMonth: 50, createdAt: new Date() },
        { id: 'child-2', name: 'Client B', slug: 'b', plan: 'CREATOR', quotaShortsPerMonth: 500, createdAt: new Date() },
      ],
    },
    usageEvent: { count: async ({ where }) => (where.organizationId === 'child-1' ? 3 : 10) },
    channel: { count: async () => 1 },
    video: { findFirst: async () => ({ createdAt: new Date() }) },
  });
  const service = new AgencyService(prisma, makeAuditLog());

  const result = await service.dashboard('org-parent');

  assert.equal(result.clientCount, 2);
  assert.equal(result.totalShortsPublishedThisMonth, 13);
  assert.equal(result.clients[0].health, 'green');
});
