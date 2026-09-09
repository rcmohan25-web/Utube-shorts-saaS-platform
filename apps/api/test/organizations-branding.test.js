const test = require('node:test');
const assert = require('node:assert/strict');
const { OrganizationsService } = require('../dist/organizations/organizations.service.js');

function makeAuditLog(onRecord) {
  return { record: async (entry) => { onRecord?.(entry); } };
}

function makeStorage(overrides = {}) {
  return {
    getPresignedUploadUrl: async (key) => `https://upload.example/${key}`,
    getPresignedUrl: async (key) => `https://cdn.example/${key}`,
    ...overrides,
  };
}

function makePrisma(org, overrides = {}) {
  return {
    client: {
      organization: {
        findUnique: async () => org,
        findUniqueOrThrow: async () => org,
        update: async (args) => ({ ...org, ...args.data }),
        ...overrides.organization,
      },
    },
  };
}

test('updateBranding persists brandColor and logoS3Key and records an AuditLog entry', async () => {
  const recorded = [];
  const org = { id: 'org-1', webhookUrl: null, brandColor: null, logoS3Key: null };
  const service = new OrganizationsService(makePrisma(org), makeAuditLog((e) => recorded.push(e)), makeStorage());

  const updated = await service.updateBranding(
    'org-1',
    { brandColor: '#112233', logoS3Key: 'org-1/branding/logo-1.png' },
    'user-1',
  );

  assert.equal(updated.brandColor, '#112233');
  assert.equal(updated.logoS3Key, 'org-1/branding/logo-1.png');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].action, 'organization.branding_updated');
  assert.equal(recorded[0].organizationId, 'org-1');
  assert.equal(recorded[0].userId, 'user-1');
  assert.equal(recorded[0].metadata.brandColorChanged, true);
  assert.equal(recorded[0].metadata.logoChanged, true);
  assert.equal(recorded[0].metadata.webhookUrlChanged, false);
});

test('updateBranding leaves brandColor/logoS3Key untouched when the caller omits them', async () => {
  const org = { id: 'org-1', webhookUrl: null, brandColor: '#654321', logoS3Key: 'org-1/branding/logo-old.png' };
  const service = new OrganizationsService(makePrisma(org), makeAuditLog(), makeStorage());

  const updated = await service.updateBranding('org-1', { webhookUrl: 'https://hooks.example/x' }, 'user-1');

  assert.equal(updated.brandColor, '#654321');
  assert.equal(updated.logoS3Key, 'org-1/branding/logo-old.png');
  assert.equal(updated.webhookUrl, 'https://hooks.example/x');
});

test('requestLogoUploadUrl scopes the object key under {orgId}/branding/ with the right extension', async () => {
  const service = new OrganizationsService(makePrisma({ id: 'org-2' }), makeAuditLog(), makeStorage());

  const result = await service.requestLogoUploadUrl('org-2', 'image/png');

  assert.match(result.key, /^org-2\/branding\/logo-.+\.png$/);
  assert.equal(result.uploadUrl, `https://upload.example/${result.key}`);
});

test('requestLogoUploadUrl falls back to .png for an unrecognized content type', async () => {
  const service = new OrganizationsService(makePrisma({ id: 'org-2' }), makeAuditLog(), makeStorage());

  const result = await service.requestLogoUploadUrl('org-2', 'application/octet-stream');

  assert.match(result.key, /\.png$/);
});

test('getPublicBranding reports whiteLabelEnabled=true only for Agency+ plans (§20.7 FLAGS.WHITE_LABEL)', async () => {
  const starterService = new OrganizationsService(
    makePrisma({ id: 'org-3', name: 'Starter Org', plan: 'STARTER', brandColor: '#ff0000', logoS3Key: null }),
    makeAuditLog(),
    makeStorage(),
  );
  const agencyService = new OrganizationsService(
    makePrisma({
      id: 'org-4',
      name: 'Agency Org',
      plan: 'AGENCY',
      brandColor: '#00ff00',
      logoS3Key: 'org-4/branding/logo.png',
    }),
    makeAuditLog(),
    makeStorage(),
  );

  const starterBranding = await starterService.getPublicBranding('org-3');
  const agencyBranding = await agencyService.getPublicBranding('org-4');

  assert.equal(starterBranding.whiteLabelEnabled, false);
  assert.equal(starterBranding.logoUrl, null); // no logoS3Key set
  assert.equal(agencyBranding.whiteLabelEnabled, true);
  assert.equal(agencyBranding.logoUrl, 'https://cdn.example/org-4/branding/logo.png');
});

test('getPublicBranding returns null logoUrl when no logo has been uploaded, even on a white-label plan', async () => {
  const service = new OrganizationsService(
    makePrisma({ id: 'org-5', name: 'No Logo Yet', plan: 'ENTERPRISE', brandColor: null, logoS3Key: null }),
    makeAuditLog(),
    makeStorage(),
  );

  const branding = await service.getPublicBranding('org-5');

  assert.equal(branding.whiteLabelEnabled, true);
  assert.equal(branding.logoUrl, null);
  assert.equal(branding.brandColor, null);
});
