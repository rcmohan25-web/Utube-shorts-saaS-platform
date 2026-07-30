const test = require('node:test');
const assert = require('node:assert/strict');
const { AnalyticsSyncProcessor } = require('../dist/analytics/analytics-sync.processor.js');
const { AnalyticsService } = require('../dist/analytics/analytics.service.js');

test('AnalyticsSyncProcessor skips a Short that is not PUBLISHED (e.g. re-rendered since job was queued)', async () => {
  let fetchCalled = false;

  const processor = new AnalyticsSyncProcessor(
    {
      client: {
        short: {
          findFirst: async () => ({
            id: 'short-1',
            status: 'RENDERING',
            youtubeVideoId: null,
            channel: { userId: 'user-1' },
          }),
        },
        analyticsDaily: { upsert: async () => { throw new Error('should not be called'); } },
      },
    },
    { getValidAccessToken: async () => 'token' },
    { fetchDailyMetrics: async () => { fetchCalled = true; return []; } },
  );

  await processor.process({ data: { shortId: 'short-1', organizationId: 'org-1' } });

  assert.equal(fetchCalled, false);
});

test('AnalyticsSyncProcessor upserts one AnalyticsDaily row per day returned by the API', async () => {
  const upserted = [];

  const processor = new AnalyticsSyncProcessor(
    {
      client: {
        short: {
          findFirst: async () => ({
            id: 'short-2',
            organizationId: 'org-2',
            status: 'PUBLISHED',
            youtubeVideoId: 'yt-vid-1',
            channel: { userId: 'user-2' },
          }),
        },
        analyticsDaily: {
          upsert: async (args) => {
            upserted.push(args);
            return {};
          },
        },
      },
    },
    { getValidAccessToken: async () => 'token-2' },
    {
      fetchDailyMetrics: async () => [
        { date: '2026-07-28', views: 100, watchTimeSeconds: 500, likes: 10, comments: 2, shares: 1, subscribersGained: 3 },
        { date: '2026-07-29', views: 150, watchTimeSeconds: 700, likes: 12, comments: 3, shares: 2, subscribersGained: 1 },
      ],
    },
  );

  await processor.process({ data: { shortId: 'short-2', organizationId: 'org-2', daysBack: 3 } });

  assert.equal(upserted.length, 2);
  assert.equal(upserted[0].create.views, 100);
  assert.equal(upserted[0].create.organizationId, 'org-2');
  assert.equal(upserted[1].create.views, 150);
  // §20.6 idempotency: upsert keyed on the compound unique, not a manual find+create/update
  assert.ok(upserted[0].where.shortId_date);
});

test('AnalyticsService.overview computes SUM/AVG/MAX metrics correctly (§17.2)', async () => {
  const rows = [
    { shortId: 'short-a', date: new Date('2026-07-28'), views: 100, watchTimeSeconds: 500, likes: 5, comments: 1, shares: 0, subscribersGained: 2 },
    { shortId: 'short-a', date: new Date('2026-07-29'), views: 50, watchTimeSeconds: 200, likes: 2, comments: 0, shares: 0, subscribersGained: 0 },
    { shortId: 'short-b', date: new Date('2026-07-28'), views: 300, watchTimeSeconds: 1200, likes: 20, comments: 5, shares: 3, subscribersGained: 10 },
  ];

  const service = new AnalyticsService(
    {
      client: {
        analyticsDaily: { findMany: async () => rows },
        short: { count: async () => 4 },
      },
    },
    { add: async () => ({ id: 'job-1' }) },
  );

  const result = await service.overview('org-1', new Date('2026-07-28'), new Date('2026-07-29'));

  assert.equal(result.totalViews, 450);
  assert.equal(result.totalWatchTimeSeconds, 1900);
  assert.equal(result.avgViewDurationSeconds, 1900 / 450);
  assert.equal(result.bestShortId, 'short-b'); // 300 views alone beats short-a's 150 total
  assert.equal(result.publishRate, 2); // 4 published / 2 days in period
  assert.equal(result.series.length, 2);
  assert.equal(result.series[0].views, 400); // both Shorts on 07-28: 100 + 300
});

test('AnalyticsService.scheduleFirstSync enqueues a delayed, idempotent job (§17.1)', async () => {
  let addedArgs = null;

  const service = new AnalyticsService(
    { client: {} },
    {
      add: async (name, data, opts) => {
        addedArgs = { name, data, opts };
        return { id: 'job-2' };
      },
    },
  );

  await service.scheduleFirstSync('short-3', 'org-3');

  assert.equal(addedArgs.name, 'sync');
  assert.equal(addedArgs.data.shortId, 'short-3');
  assert.equal(addedArgs.data.daysBack, 1);
  assert.equal(addedArgs.opts.jobId, 'analytics-sync-first_short-3'); // re-add is a safe no-op
  assert.equal(addedArgs.opts.delay, 24 * 60 * 60 * 1000);
});
