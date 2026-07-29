const test = require('node:test');
const assert = require('node:assert/strict');
const { ConflictException } = require('@nestjs/common');
const { PublishProcessor } = require('../dist/queues/processors/publish.processor.js');
const { SchedulesService } = require('../dist/schedules/schedules.service.js');

test('retrying a published schedule with a YouTube video id does not dispatch a new upload', async () => {
  let markPublishedCalls = 0;
  let accessTokenCalls = 0;
  let dispatchCalls = 0;

  const processor = new PublishProcessor(
    {
      client: {
        schedule: {
          findFirst: async () => ({
            id: 'schedule-1',
            organizationId: 'org-1',
            status: 'PUBLISHED',
            shortId: 'short-1',
            short: {
              id: 'short-1',
              youtubeVideoId: 'yt-video-123',
              renderS3Key: 'renders/abc.mp4',
            },
            channel: { userId: 'user-1' },
          }),
        },
      },
    },
    {
      getValidAccessToken: async () => {
        accessTokenCalls += 1;
        return 'token';
      },
    },
    {
      markPublished: async () => {
        markPublishedCalls += 1;
      },
    },
  );

  await processor.process({ data: { scheduleId: 'schedule-1', organizationId: 'org-1' } });

  assert.equal(markPublishedCalls, 1);
  assert.equal(accessTokenCalls, 0);
  assert.equal(dispatchCalls, 0);
});

test('create rejects a short that is already published even without a schedule row', async () => {
  const service = new SchedulesService(
    {
      client: {
        short: {
          findFirst: async () => ({
            id: 'short-1',
            organizationId: 'org-1',
            status: 'PUBLISHED',
            youtubeVideoId: 'yt-video-123',
            renderS3Key: 'renders/abc.mp4',
          }),
        },
        schedule: {
          findFirst: async () => null,
        },
      },
    },
    {},
    {},
    { add: async () => ({ id: 'job-1' }) },
  );

  await assert.rejects(
    () =>
      service.create(
        {
          shortId: 'short-1',
          channelId: 'channel-1',
          scheduledAt: '2026-07-30T22:00:00.000Z',
        },
        'org-1',
        'user-1',
      ),
    (err) => {
      assert.ok(err instanceof ConflictException);
      assert.equal(err.message, 'This Short has already been published to YouTube');
      return true;
    },
  );
});

test('checkStuckSchedules marks stale pending schedules as failed', async () => {
  let failedCalls = 0;
  const service = new SchedulesService(
    {
      client: {
        schedule: {
          findMany: async () => [
            {
              id: 'schedule-2',
              organizationId: 'org-2',
              status: 'PENDING',
              scheduledAt: new Date(Date.now() - 31 * 60 * 1000),
            },
          ],
        },
      },
    },
    {},
    {},
    { add: async () => ({ id: 'job-1' }) },
  );

  service.markFailed = async (scheduleId, organizationId, errorMessage) => {
    failedCalls += 1;
    assert.equal(scheduleId, 'schedule-2');
    assert.equal(organizationId, 'org-2');
    assert.match(errorMessage, /publish-worker did not report back/i);
    return { id: scheduleId, status: 'FAILED' };
  };

  await service.checkStuckSchedules();

  assert.equal(failedCalls, 1);
});

test('markFailed leaves a published schedule unchanged when a stale failure callback arrives', async () => {
  let updateCalls = 0;
  const service = new SchedulesService(
    {
      client: {
        schedule: {
          findFirst: async () => ({
            id: 'schedule-3',
            organizationId: 'org-3',
            status: 'PUBLISHED',
            shortId: 'short-3',
          }),
          update: async () => {
            updateCalls += 1;
            return { id: 'schedule-3', status: 'FAILED' };
          },
        },
      },
    },
    {},
    {},
    { add: async () => ({ id: 'job-1' }) },
  );

  const result = await service.markFailed('schedule-3', 'org-3', 'stale callback');

  assert.equal(updateCalls, 0);
  assert.equal(result.status, 'PUBLISHED');
});
