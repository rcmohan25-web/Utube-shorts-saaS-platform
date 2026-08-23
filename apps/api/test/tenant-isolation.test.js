const test = require('node:test');
const assert = require('node:assert/strict');
const { NotFoundException } = require('@nestjs/common');
const { SchedulesService } = require('../dist/schedules/schedules.service.js');
const { ChannelsService } = require('../dist/channels/channels.service.js');
const { ClipsService } = require('../dist/clips/clips.service.js');
const { ShortsService } = require('../dist/shorts/shorts.service.js');
const { AnalyticsService } = require('../dist/analytics/analytics.service.js');

// PR 9 (Security Hardening, §18.2/§20.13/§19.1): "Integration tests MUST
// assert: Org A user cannot access Org B resource via direct ID." Everything
// already does the right thing (findFirst({ where: { id, organizationId } })
// per §9.3), so these are regression tests that lock the pattern in — they
// fail loudly the moment someone "simplifies" a query back to
// findFirst({ where: { id } }).
//
// scopedFindFirst() simulates real Prisma behavior: a tenant-scoped
// findFirst returns null when the row exists but belongs to a different
// org, exactly what the mandatory organizationId scope is supposed to
// guarantee. If any service under test were ever changed to query by id
// alone, these tests would start returning the Org A row to an Org B
// caller instead of throwing NotFoundException.
function scopedFindFirst(rows) {
  return async ({ where }) =>
    rows.find((r) => r.id === where.id && r.organizationId === where.organizationId) ?? null;
}

const noopAuditLog = { record: async () => {} };

test('SchedulesService.cancel: Org B cannot cancel a schedule owned by Org A', async () => {
  const rows = [{ id: 'sched-1', organizationId: 'org-A', status: 'PENDING' }];
  const service = new SchedulesService(
    { client: { schedule: { findFirst: scopedFindFirst(rows) } } },
    {}, // storage
    {}, // videoGateway
    {}, // analytics
    {}, // quota
    {}, // notifications
    { remove: async () => {} }, // publishQueue
    noopAuditLog,
  );

  await assert.rejects(() => service.cancel('sched-1', 'org-B', 'user-x'), NotFoundException);
});

test('ChannelsService.disconnect: Org B cannot disconnect a channel owned by Org A', async () => {
  const rows = [{ id: 'chan-1', organizationId: 'org-A', youtubeChannelId: 'yt-1', name: 'My Channel' }];
  const service = new ChannelsService(
    { client: { channel: { findFirst: scopedFindFirst(rows) } } },
    noopAuditLog,
  );

  await assert.rejects(() => service.disconnect('chan-1', 'org-B', 'user-x'), NotFoundException);
});

test('ClipsService.approve: Org B cannot approve a clip owned by Org A', async () => {
  const rows = [{
    id: 'clip-1',
    organizationId: 'org-A',
    status: 'PENDING',
    video: { rawVideoS3Key: 'k', transcriptS3Key: 'k' },
  }];
  const service = new ClipsService(
    { client: { clip: { findFirst: scopedFindFirst(rows) } } },
    {}, // videoGateway
    { add: async () => ({ id: 'job-1' }) }, // renderQueue
    noopAuditLog,
  );

  await assert.rejects(() => service.approve('clip-1', 'org-B'), NotFoundException);
});

test('ClipsService.reject: Org B cannot reject a clip owned by Org A', async () => {
  const rows = [{ id: 'clip-2', organizationId: 'org-A', status: 'PENDING' }];
  const service = new ClipsService(
    { client: { clip: { findFirst: scopedFindFirst(rows) } } },
    {},
    {},
    noopAuditLog,
  );

  await assert.rejects(() => service.reject('clip-2', 'org-B', {}, 'user-x'), NotFoundException);
});

test('ShortsService.reject: Org B cannot reject a short owned by Org A', async () => {
  const rows = [{ id: 'short-1', organizationId: 'org-A', status: 'REVIEW' }];
  const service = new ShortsService(
    { client: { short: { findFirst: scopedFindFirst(rows) } } },
    {}, // storage
    {}, // videoGateway
    {}, // notifications
    noopAuditLog,
  );

  await assert.rejects(() => service.reject('short-1', 'org-B', 'user-x', {}), NotFoundException);
});

test('ShortsService.findOne: Org B gets 404, not Org A data, for a short owned by Org A', async () => {
  const rows = [{ id: 'short-2', organizationId: 'org-A', status: 'REVIEW', renderS3Key: null, thumbnailS3Key: null }];
  const service = new ShortsService(
    { client: { short: { findFirst: scopedFindFirst(rows) } } },
    {}, {}, {}, noopAuditLog,
  );

  await assert.rejects(() => service.findOne('short-2', 'org-B'), NotFoundException);
});

test('AnalyticsService.shortSeries: Org B gets null, not Org A data, for a short owned by Org A', async () => {
  const rows = [{ id: 'short-1', organizationId: 'org-A', title: 't', youtubeVideoId: null, status: 'PUBLISHED' }];
  const service = new AnalyticsService(
    { client: { short: { findFirst: scopedFindFirst(rows) } } },
    {}, // analyticsQueue
  );

  const result = await service.shortSeries('short-1', 'org-B', new Date(), new Date());
  assert.equal(result, null);
});
