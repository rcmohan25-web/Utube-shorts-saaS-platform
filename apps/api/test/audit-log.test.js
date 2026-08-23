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
