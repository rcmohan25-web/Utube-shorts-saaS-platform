const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsSyncProcessor } = require('../dist/analytics/analytics-sync.processor.js');
const { AnalyticsService } = require('../dist/analytics/analytics.service.js');

// PR 13 (§17 follow-up: Analytics API call batching).
//
// These tests sit alongside apps/api/test/analytics.test.js (which still
// covers the original single-Short 'sync' path — scheduleFirstSync() and
// processSingle() are untouched by this PR) and exercise only what's new:
// the 'batch-sync' job path and dailySyncAllPublished()'s grouping/chunking.

test('AnalyticsSyncProcessor batch-sync job makes exactly one fetchDailyMetricsBatch call for multiple Shorts on the same channel', async () => {
  let fetchCallCount = 0;
  let fetchedVideoIds = null;
  const upserts = [];

  const processor = new AnalyticsSyncProcessor(
    {
      client: {
        short: {
          findMany: async ({ where }) => where.id.in.map((id) => ({ id })),
        },
        analyticsDaily: {
          upsert: async (args) => { upserts.push(args); return {}; },
        },
      },
    },
    { getValidAccessToken: async () => 'token-batch' },
    {
      fetchDailyMetricsBatch: async (videoIds) => {
        fetchCallCount += 1;
        fetchedVideoIds = videoIds;
        const map = new Map();
        for (const id of videoIds) {
          map.set(id, [
            { date: '2026-08-01', views: 10, watchTimeSeconds: 60, likes: 1, comments: 0, shares: 0, subscribersGained: 0 },
          ]);
        }
        return map;
      },
    },
  );

  await processor.process({
    name: 'batch-sync',
    data: {
      organizationId: 'org-1',
      channelId: 'chan-1',
      userId: 'user-1',
      items: [
        { shortId: 'short-1', youtubeVideoId: 'yt-short-1' },
        { shortId: 'short-2', youtubeVideoId: 'yt-short-2' },
        { shortId: 'short-3', youtubeVideoId: 'yt-short-3' },
      ],
    },
  });

  assert.equal(fetchCallCount, 1); // one YouTube Analytics API call for all 3 Shorts
  assert.equal(fetchedVideoIds.length, 3);
  assert.equal(upserts.length, 3); // one AnalyticsDaily row per Short
});

test('AnalyticsSyncProcessor batch-sync skips Shorts that are no longer PUBLISHED at fire time', async () => {
  let fetchedVideoIds = null;
  const processor = new AnalyticsSyncProcessor(
    {
      client: {
        short: {
          // Only short-1 is still PUBLISHED — short-2 was re-rendered/rejected since the cron ran.
          findMany: async () => [{ id: 'short-1' }],
        },
        analyticsDaily: { upsert: async () => ({}) },
      },
    },
    { getValidAccessToken: async () => 'token' },
    {
      fetchDailyMetricsBatch: async (videoIds) => {
        fetchedVideoIds = videoIds;
        return new Map();
      },
    },
  );

  await processor.process({
    name: 'batch-sync',
    data: {
      organizationId: 'org-1',
      channelId: 'chan-1',
      userId: 'user-1',
      items: [
        { shortId: 'short-1', youtubeVideoId: 'yt-short-1' },
        { shortId: 'short-2', youtubeVideoId: 'yt-short-2' },
      ],
    },
  });

  assert.deepEqual(fetchedVideoIds, ['yt-short-1']);
});

test('AnalyticsSyncProcessor batch-sync makes no API call when nothing in the batch is still published', async () => {
  let fetchCalled = false;
  const processor = new AnalyticsSyncProcessor(
    { client: { short: { findMany: async () => [] }, analyticsDaily: { upsert: async () => ({}) } } },
    { getValidAccessToken: async () => 'token' },
    { fetchDailyMetricsBatch: async () => { fetchCalled = true; return new Map(); } },
  );

  await processor.process({
    name: 'batch-sync',
    data: { organizationId: 'org-1', channelId: 'chan-1', userId: 'user-1', items: [{ shortId: 's', youtubeVideoId: 'yt-s' }] },
  });

  assert.equal(fetchCalled, false);
});

test('AnalyticsSyncProcessor batch-sync writes one AnalyticsDaily upsert per returned day, across multiple Shorts', async () => {
  const upserts = [];
  const processor = new AnalyticsSyncProcessor(
    {
      client: {
        short: { findMany: async () => [{ id: 'short-1' }, { id: 'short-2' }] },
        analyticsDaily: { upsert: async (args) => { upserts.push(args); return {}; } },
      },
    },
    { getValidAccessToken: async () => 'token' },
    {
      fetchDailyMetricsBatch: async () => new Map([
        ['yt-1', [
          { date: '2026-08-01', views: 5, watchTimeSeconds: 30, likes: 0, comments: 0, shares: 0, subscribersGained: 0 },
          { date: '2026-08-02', views: 7, watchTimeSeconds: 40, likes: 1, comments: 0, shares: 0, subscribersGained: 0 },
        ]],
        ['yt-2', [
          { date: '2026-08-01', views: 3, watchTimeSeconds: 15, likes: 0, comments: 0, shares: 0, subscribersGained: 0 },
        ]],
      ]),
    },
  );

  await processor.process({
    name: 'batch-sync',
    data: {
      organizationId: 'org-1',
      channelId: 'chan-1',
      userId: 'user-1',
      items: [
        { shortId: 'short-1', youtubeVideoId: 'yt-1' },
        { shortId: 'short-2', youtubeVideoId: 'yt-2' },
      ],
    },
  });

  assert.equal(upserts.length, 3); // 2 days for short-1 + 1 day for short-2
  assert.ok(upserts.every((u) => u.where.shortId_date)); // §20.6 idempotency: upsert keyed on the compound unique
});

test('AnalyticsSyncProcessor single-Short "sync" job path (processSingle) still works unmodified', async () => {
  const upserts = [];
  const processor = new AnalyticsSyncProcessor(
    {
      client: {
        short: {
          findFirst: async () => ({
            id: 'short-solo',
            organizationId: 'org-1',
            status: 'PUBLISHED',
            youtubeVideoId: 'yt-solo',
            channel: { userId: 'user-1' },
          }),
        },
        analyticsDaily: { upsert: async (args) => { upserts.push(args); return {}; } },
      },
    },
    { getValidAccessToken: async () => 'token' },
    {
      fetchDailyMetrics: async () => [
        { date: '2026-08-01', views: 100, watchTimeSeconds: 500, likes: 5, comments: 1, shares: 0, subscribersGained: 2 },
      ],
    },
  );

  await processor.process({ name: 'sync', data: { shortId: 'short-solo', organizationId: 'org-1' } });

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].create.views, 100);
});

test('AnalyticsService.dailySyncAllPublished groups Shorts by channel and chunks batches at 40 per call', async () => {
  const shorts = [];
  for (let i = 0; i < 45; i++) {
    shorts.push({
      id: `short-${i}`,
      organizationId: 'org-1',
      channelId: 'chan-A',
      youtubeVideoId: `yt-${i}`,
      channel: { userId: 'user-A' },
    });
  }
  shorts.push({
    id: 'short-other',
    organizationId: 'org-2',
    channelId: 'chan-B',
    youtubeVideoId: 'yt-other',
    channel: { userId: 'user-B' },
  });

  const added = [];
  const service = new AnalyticsService(
    { client: { short: { findMany: async () => shorts } } },
    { add: async (name, data, opts) => { added.push({ name, data, opts }); return { id: 'job-x' }; } },
  );

  await service.dailySyncAllPublished();

  const chanA = added.filter((a) => a.data.channelId === 'chan-A');
  const chanB = added.filter((a) => a.data.channelId === 'chan-B');

  // 45 Shorts on chan-A -> two batches of 40 and 5, not 45 individual jobs.
  assert.equal(chanA.length, 2);
  assert.equal(chanA[0].data.items.length, 40);
  assert.equal(chanA[1].data.items.length, 5);
  assert.equal(chanB.length, 1);
  assert.equal(chanB[0].data.items.length, 1);
  assert.ok(added.every((a) => a.name === 'batch-sync'));
  assert.ok(added.every((a) => a.opts.jobId.includes(a.data.channelId)));
});

test('AnalyticsService.dailySyncAllPublished skips a PUBLISHED Short with no youtubeVideoId rather than crashing', async () => {
  const shorts = [
    { id: 'short-bad', organizationId: 'org-1', channelId: 'chan-A', youtubeVideoId: null, channel: { userId: 'user-A' } },
    { id: 'short-good', organizationId: 'org-1', channelId: 'chan-A', youtubeVideoId: 'yt-good', channel: { userId: 'user-A' } },
  ];
  const added = [];
  const service = new AnalyticsService(
    { client: { short: { findMany: async () => shorts } } },
    { add: async (name, data, opts) => { added.push({ name, data, opts }); return { id: 'x' }; } },
  );

  await service.dailySyncAllPublished();

  assert.equal(added.length, 1);
  assert.deepEqual(added[0].data.items, [{ shortId: 'short-good', youtubeVideoId: 'yt-good' }]);
});

test('AnalyticsService.dailySyncAllPublished enqueues nothing when there are no published Shorts', async () => {
  const added = [];
  const service = new AnalyticsService(
    { client: { short: { findMany: async () => [] } } },
    { add: async (name, data, opts) => { added.push({ name, data, opts }); return { id: 'x' }; } },
  );

  await service.dailySyncAllPublished();

  assert.equal(added.length, 0);
});

test('AnalyticsService.dailySyncAllPublished jobId is stable within the same UTC day (idempotent re-run)', async () => {
  const shorts = [
    { id: 'short-1', organizationId: 'org-1', channelId: 'chan-A', youtubeVideoId: 'yt-1', channel: { userId: 'user-A' } },
  ];
  const added = [];
  const service = new AnalyticsService(
    { client: { short: { findMany: async () => shorts } } },
    { add: async (name, data, opts) => { added.push(opts.jobId); return { id: 'x' }; } },
  );

  await service.dailySyncAllPublished();
  await service.dailySyncAllPublished();

  assert.equal(added[0], added[1]); // same jobId both times -> second add() is a safe no-op in real BullMQ
});
