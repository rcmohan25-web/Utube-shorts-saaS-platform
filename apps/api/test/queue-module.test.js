const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('queue module opts into offline queue behavior for resilient Redis startup', () => {
  const queueModuleSource = fs.readFileSync(
    path.join(__dirname, '../src/queues/queue.module.ts'),
    'utf8',
  );

  assert.match(queueModuleSource, /enableOfflineQueue:\s*true/);
  assert.match(queueModuleSource, /lazyConnect:\s*true/);
});
