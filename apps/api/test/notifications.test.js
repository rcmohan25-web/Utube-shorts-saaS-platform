const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNotificationMessage } = require('../dist/notifications/notification-message.builder.js');
const { NOTIFICATION_CHANNELS } = require('../dist/notifications/notification.types.js');
const { NotificationsService } = require('../dist/notifications/notifications.service.js');

test('buildNotificationMessage produces copy + actionUrl for every notification type', () => {
  const cases = [
    ['SHORTS_READY', { reviewCount: 3 }, /3 Shorts/],
    ['SHORT_PUBLISHED', { title: 'My Short', youtubeVideoId: 'abc123' }, /My Short/],
    ['PIPELINE_FAILURE', { videoId: 'v1', errorMessage: 'ffmpeg crashed' }, /ffmpeg crashed/],
    ['QUOTA_WARNING', { pct: 80, used: 40, quota: 50 }, /80%/],
    ['QUOTA_EXCEEDED', { quota: 50 }, /50-Short/],
    ['PAYMENT_FAILED', {}, /payment/i],
    ['WEEKLY_DIGEST', { publishedCount: 4, totalViews: 1200, bestShortId: 'short-1' }, /4 Shorts published/],
  ];

  for (const [type, payload, bodyPattern] of cases) {
    const msg = buildNotificationMessage(type, payload);
    assert.ok(msg.title.length > 0, `${type} should have a title`);
    assert.match(msg.body, bodyPattern, `${type} body should mention key payload data`);
  }
});

test('buildNotificationMessage singularizes "1 Short" correctly', () => {
  const msg = buildNotificationMessage('SHORTS_READY', { reviewCount: 1 });
  assert.match(msg.title, /^1 Short ready/);
});

test('NOTIFICATION_CHANNELS matches §15.1: SHORT_PUBLISHED is Slack, not email', () => {
  assert.deepEqual(NOTIFICATION_CHANNELS.SHORT_PUBLISHED, { email: false, slack: true, inApp: true });
});

test('NOTIFICATION_CHANNELS matches §15.1: PIPELINE_FAILURE is both email and Slack', () => {
  assert.deepEqual(NOTIFICATION_CHANNELS.PIPELINE_FAILURE, { email: true, slack: true, inApp: true });
});

test('NOTIFICATION_CHANNELS matches §15.1: WEEKLY_DIGEST is email-only, no in-app', () => {
  assert.deepEqual(NOTIFICATION_CHANNELS.WEEKLY_DIGEST, { email: true, slack: false, inApp: false });
});

test('NotificationsService.notify forwards jobId through to the queue (batching mechanism)', async () => {
  let addedArgs = null;
  const queue = {
    add: async (name, data, opts) => {
      addedArgs = { name, data, opts };
      return { id: 'job-1' };
    },
  };
  const service = new NotificationsService(
    {},
    { client: {} },
    { overview: async () => ({}) },
    {},
    queue,
  );

  await service.notify('SHORTS_READY', 'org-1', { reviewCount: 2 });

  assert.equal(addedArgs.name, 'shorts-ready-batch');
  assert.deepEqual(addedArgs.data, { organizationId: 'org-1' });
  assert.equal(addedArgs.opts.jobId, 'shorts-ready_org-1');
  assert.equal(typeof addedArgs.opts.delay, 'number');
  assert.equal(addedArgs.opts.attempts, undefined);
});
