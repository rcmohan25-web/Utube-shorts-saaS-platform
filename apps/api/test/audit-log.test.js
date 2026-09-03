const test = require('node:test');
const assert = require('node:assert/strict');
const { AuditLogService } = require('../dist/audit/audit-log.service.js');

test('AuditLogService.record() writes a row with organizationId, action, and metadata', async () => {
  let created = null;
  const prisma = {
    client: {
      auditLog: {
        create: async (args) => {
          created = args;
          return { id: 'log-1', ...args.data };
        },
      },
    },
  };
  const service = new AuditLogService(prisma);

  await service.record({
    organizationId: 'org-1',
    userId: 'user-1',
    action: 'clip.reject',
    resourceType: 'clip',
    resourceId: 'clip-1',
    metadata: { reason: 'Off-brand' },
  });

  assert.equal(created.data.organizationId, 'org-1');
  assert.equal(created.data.userId, 'user-1');
  assert.equal(created.data.action, 'clip.reject');
  assert.equal(created.data.resourceType, 'clip');
  assert.equal(created.data.resourceId, 'clip-1');
  assert.deepEqual(created.data.metadata, { reason: 'Off-brand' });
});

test('AuditLogService.record() defaults userId/resourceType/resourceId/metadata/ipAddress to null when omitted', async () => {
  let created = null;
  const prisma = {
    client: {
      auditLog: {
        create: async (args) => { created = args; return { id: 'log-2', ...args.data }; },
      },
    },
  };
  const service = new AuditLogService(prisma);

  await service.record({ organizationId: 'org-1', action: 'organization.branding_updated' });

  assert.equal(created.data.userId, null);
  assert.equal(created.data.resourceType, null);
  assert.equal(created.data.resourceId, null);
  assert.equal(created.data.metadata, null);
  assert.equal(created.data.ipAddress, null);
});

test('AuditLogService.record() propagates a write failure rather than swallowing it', async () => {
  const prisma = {
    client: {
      auditLog: {
        create: async () => { throw new Error('DB unavailable'); },
      },
    },
  };
  const service = new AuditLogService(prisma);

  await assert.rejects(
    () => service.record({ organizationId: 'org-1', action: 'user.deactivated' }),
    /DB unavailable/,
  );
});

// PR 11 (§9.4 follow-up: audit log admin UI) — query() pagination + filters

test('query() scopes to organizationId and applies action/userId/resourceType/date filters', async () => {
  let capturedWhere = null;
  const prisma = {
    client: {
      auditLog: {
        findMany: async (args) => { capturedWhere = args.where; return []; },
      },
    },
  };
  const service = new AuditLogService(prisma);

  await service.query('org-1', {
    action: 'clip.reject',
    userId: 'user-9',
    resourceType: 'clip',
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-31T23:59:59.000Z',
  });

  assert.equal(capturedWhere.organizationId, 'org-1');
  assert.equal(capturedWhere.action, 'clip.reject');
  assert.equal(capturedWhere.userId, 'user-9');
  assert.equal(capturedWhere.resourceType, 'clip');
  assert.ok(capturedWhere.createdAt.gte instanceof Date);
  assert.ok(capturedWhere.createdAt.lte instanceof Date);
});

test('query() returns nextCursor only when there are more rows than the page size', async () => {
  const makeRow = (i) => ({ id: `log-${i}`, createdAt: new Date(2026, 7, i) });
  const prisma = {
    client: {
      auditLog: {
        // Service asks for limit+1 rows to detect a next page.
        findMany: async (args) => {
          assert.equal(args.take, 3);
          return [makeRow(1), makeRow(2), makeRow(3)]; // 3 rows for a limit of 2 -> hasMore
        },
      },
    },
  };
  const service = new AuditLogService(prisma);

  const page = await service.query('org-1', { limit: 2 });

  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, 'log-2');
});

test('query() returns a null nextCursor on the last page', async () => {
  const makeRow = (i) => ({ id: `log-${i}`, createdAt: new Date(2026, 7, i) });
  const prisma = {
    client: {
      auditLog: {
        findMany: async () => [makeRow(1)], // fewer rows than limit+1
      },
    },
  };
  const service = new AuditLogService(prisma);

  const page = await service.query('org-1', { limit: 50 });

  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, null);
});

test('query() clamps limit to the 1-100 range', async () => {
  let capturedTake = null;
  const prisma = {
    client: {
      auditLog: { findMany: async (args) => { capturedTake = args.take; return []; } },
    },
  };
  const service = new AuditLogService(prisma);

  await service.query('org-1', { limit: 5000 });
  assert.equal(capturedTake, 101); // 100 (clamped) + 1 lookahead

  await service.query('org-1', { limit: -10 });
  assert.equal(capturedTake, 2); // 1 (clamped) + 1 lookahead
});

test('query() passes the cursor through as { cursor: { id }, skip: 1 } for page 2+', async () => {
  let capturedArgs = null;
  const prisma = {
    client: {
      auditLog: { findMany: async (args) => { capturedArgs = args; return []; } },
    },
  };
  const service = new AuditLogService(prisma);

  await service.query('org-1', { cursor: 'log-50' });

  assert.deepEqual(capturedArgs.cursor, { id: 'log-50' });
  assert.equal(capturedArgs.skip, 1);
});

test('distinctActions() returns only this org\'s distinct action values', async () => {
  let capturedWhere = null;
  const prisma = {
    client: {
      auditLog: {
        findMany: async (args) => {
          capturedWhere = args.where;
          return [{ action: 'clip.reject' }, { action: 'short.reject' }];
        },
      },
    },
  };
  const service = new AuditLogService(prisma);

  const actions = await service.distinctActions('org-1');

  assert.equal(capturedWhere.organizationId, 'org-1');
  assert.deepEqual(actions, ['clip.reject', 'short.reject']);
});
