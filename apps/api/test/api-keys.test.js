const test = require('node:test');
const assert = require('node:assert/strict');
const { ApiKeysService } = require('../dist/api-keys/api-keys.service.js');

function makeAuditLog(onRecord) {
  return { record: async (entry) => { onRecord?.(entry); } };
}

test('create() returns the raw key exactly once and persists only a prefix + hash', async () => {
  let stored = null;
  const prisma = {
    client: {
      apiKey: { create: async (args) => { stored = args.data; return { id: 'key-1', ...args.data }; } },
    },
  };
  const service = new ApiKeysService(prisma, makeAuditLog());

  const result = await service.create({ name: 'Zapier' }, 'org-1', 'user-1');

  assert.ok(result.rawKey.startsWith('sk_live_'));
  assert.equal(stored.keyPrefix, result.rawKey.slice(0, 16));
  assert.notEqual(stored.keyHash, result.rawKey);
  assert.equal(stored.keyHash.length, 64); // sha256 hex
});

// PR 14 (§15.2 follow-up: per-API-key scoping)

test('create() defaults scope to READ_WRITE when the caller omits it (preserves pre-PR-14 behavior)', async () => {
  let stored = null;
  const prisma = { client: { apiKey: { create: async (args) => { stored = args.data; return { id: 'key-2', ...args.data }; } } } };
  const service = new ApiKeysService(prisma, makeAuditLog());

  const result = await service.create({ name: 'No scope specified' }, 'org-1', 'user-1');

  assert.equal(stored.scope, 'READ_WRITE');
  assert.equal(result.scope, 'READ_WRITE');
});

test('create() persists an explicitly requested READ_ONLY scope', async () => {
  let stored = null;
  const prisma = { client: { apiKey: { create: async (args) => { stored = args.data; return { id: 'key-3', ...args.data }; } } } };
  const service = new ApiKeysService(prisma, makeAuditLog());

  const result = await service.create({ name: 'Read-only dashboard', scope: 'READ_ONLY' }, 'org-1', 'user-1');

  assert.equal(stored.scope, 'READ_ONLY');
  assert.equal(result.scope, 'READ_ONLY');
});

test('create() records the scope in the AuditLog entry metadata', async () => {
  const recorded = [];
  const prisma = { client: { apiKey: { create: async (args) => ({ id: 'key-4', ...args.data }) } } };
  const service = new ApiKeysService(prisma, makeAuditLog((e) => recorded.push(e)));

  await service.create({ name: 'Scoped key', scope: 'READ_ONLY' }, 'org-1', 'user-1');

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].metadata.scope, 'READ_ONLY');
});

test('list() selects the scope column alongside the existing fields', async () => {
  let selectArgs = null;
  const prisma = {
    client: {
      apiKey: { findMany: async (args) => { selectArgs = args.select; return []; } },
    },
  };
  const service = new ApiKeysService(prisma, makeAuditLog());

  await service.list('org-1');

  assert.equal(selectArgs.scope, true);
});

test('revoke() rejects an already-revoked key', async () => {
  const prisma = { client: { apiKey: { findFirst: async () => ({ id: 'key-1', status: 'REVOKED', name: 'x' }) } } };
  const service = new ApiKeysService(prisma, makeAuditLog());

  await assert.rejects(() => service.revoke('key-1', 'org-1', 'user-1'));
});

test('resolve() returns null for an unknown key and never throws', async () => {
  const prisma = { client: { apiKey: { findUnique: async () => null } } };
  const service = new ApiKeysService(prisma, makeAuditLog());

  assert.equal(await service.resolve('sk_live_doesnotexist'), null);
});

test('resolve() returns the full record including scope for a valid key', async () => {
  const prisma = {
    client: {
      apiKey: {
        findUnique: async () => ({ id: 'key-5', status: 'ACTIVE', organizationId: 'org-1', scope: 'READ_ONLY' }),
        update: async () => ({}),
      },
    },
  };
  const service = new ApiKeysService(prisma, makeAuditLog());

  const record = await service.resolve('sk_live_valid');

  assert.equal(record.scope, 'READ_ONLY');
  assert.equal(record.organizationId, 'org-1');
});
