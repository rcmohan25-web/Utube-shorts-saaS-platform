const test = require('node:test');
const assert = require('node:assert/strict');
const { BillingService } = require('../dist/billing/billing.service.js');

// These tests exercise handleWebhook()'s DB-side logic only. They monkeypatch
// getClient() to avoid real network calls / requiring a live STRIPE_SECRET_KEY,
// matching the "stub the boundary, test the logic" style used in
// publish.processor.test.js for YoutubeTokenService.
function stubStripeClient(service, { constructEventResult, subscriptionsRetrieve }) {
  service.getClient = () => ({
    webhooks: {
      constructEvent: () => constructEventResult,
    },
    subscriptions: {
      retrieve: async () => subscriptionsRetrieve,
    },
  });
}

test('handleWebhook ignores a duplicate event.id (§20.6 idempotency)', async () => {
  let createCalls = 0;
  let upsertCalls = 0;

  const prisma = {
    client: {
      stripeWebhookEvent: {
        create: async () => {
          createCalls += 1;
          const err = new Error('duplicate');
          err.code = 'P2002';
          throw err;
        },
      },
      subscription: { upsert: async () => { upsertCalls += 1; } },
      organization: { update: async () => {} },
      $transaction: async (fn) => fn(prisma.client),
    },
  };

  const service = new BillingService(prisma);
  stubStripeClient(service, {
    constructEventResult: { id: 'evt_dup', type: 'checkout.session.completed', data: { object: {} } },
  });

  await service.handleWebhook(Buffer.from('{}'), 'sig');

  assert.equal(createCalls, 1);
  assert.equal(upsertCalls, 0); // never reached — bailed out on duplicate
});

test('handleWebhook upserts a Subscription and bumps org plan on checkout.session.completed', async () => {
  const upserts = [];
  const orgUpdates = [];

  const prisma = {
    client: {
      stripeWebhookEvent: { create: async () => ({}) },
      subscription: {
        upsert: async (args) => {
          upserts.push(args);
          return {};
        },
      },
      organization: {
        update: async (args) => {
          orgUpdates.push(args);
          return {};
        },
      },
      $transaction: async (fn) => fn(prisma.client),
    },
  };

  process.env.STRIPE_PRICE_CREATOR = 'price_creator_123';
  const service = new BillingService(prisma);
  stubStripeClient(service, {
    constructEventResult: {
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_1',
          subscription: 'sub_1',
          metadata: { organizationId: 'org-9' },
        },
      },
    },
    subscriptionsRetrieve: {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: 1_700_000_000,
      current_period_end: 1_702_600_000,
      items: { data: [{ price: { id: 'price_creator_123' } }] },
    },
  });

  await service.handleWebhook(Buffer.from('{}'), 'sig');

  assert.equal(upserts.length, 1);
  assert.equal(upserts[0].create.organizationId, 'org-9');
  assert.equal(upserts[0].create.plan, 'CREATOR');
  assert.equal(orgUpdates.length, 1);
  assert.equal(orgUpdates[0].data.plan, 'CREATOR');
  assert.equal(orgUpdates[0].data.quotaShortsPerMonth, 500);
});
