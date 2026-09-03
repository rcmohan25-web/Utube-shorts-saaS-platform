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
