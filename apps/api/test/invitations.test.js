const test = require('node:test');
const assert = require('node:assert/strict');
const { ConflictException, BadRequestException, ForbiddenException } = require('@nestjs/common');
const { InvitationsService } = require('../dist/invitations/invitations.service.js');
const { UsersService } = require('../dist/organizations/users.service.js');

function makePrisma(overrides = {}) {
  return {
    client: {
      user: {
        findUnique: async () => null,
        findFirst: async () => null,
        count: async () => 1,
        update: async (args) => args,
        ...overrides.user,
      },
      invitation: {
        findFirst: async () => null,
        findUnique: async () => null,
        create: async (args) => ({ id: 'inv-1', ...args.data }),
        update: async (args) => args,
        findMany: async () => [],
        ...overrides.invitation,
      },
      organization: {
        findUniqueOrThrow: async () => ({ id: 'org-1', name: 'Acme', plan: 'STARTER' }),
        ...overrides.organization,
      },
      $transaction: async (fn) =>
        fn(
          overrides.txClient ?? {
            user: { create: async (args) => ({ id: 'user-1', ...args.data }) },
            invitation: { update: async () => ({}) },
          },
        ),
    },
  };
}

function noopAuth() {
  return { issueTokensForUser: async () => ({ accessToken: 'tok', refreshToken: 'ref' }) };
}

test('invite() rejects when the email already belongs to someone in this org', async () => {
  const prisma = makePrisma({ user: { findUnique: async () => ({ organizationId: 'org-1' }) } });
  const service = new InvitationsService(prisma, { notifyTeamInvite: async () => {} }, noopAuth());

  await assert.rejects(
    () => service.invite({ email: 'existing@co.com', role: 'EDITOR' }, 'org-1', 'user-1'),
    ConflictException,
  );
});

test('invite() rejects a duplicate pending invite for the same email', async () => {
  const prisma = makePrisma({ invitation: { findFirst: async () => ({ id: 'inv-existing' }) } });
  const service = new InvitationsService(prisma, { notifyTeamInvite: async () => {} }, noopAuth());

  await assert.rejects(
    () => service.invite({ email: 'a@b.com', role: 'EDITOR' }, 'org-1', 'user-1'),
    ConflictException,
  );
});

test('invite() sends a team-invite notification with the accept URL and stores only a hashed token', async () => {
  let notifiedArgs = null;
  const prisma = makePrisma();
  const service = new InvitationsService(
    prisma,
    { notifyTeamInvite: async (...args) => { notifiedArgs = args; } },
    noopAuth(),
  );

  const result = await service.invite({ email: 'new@co.com', role: 'EDITOR' }, 'org-1', 'user-1');

  assert.equal(notifiedArgs[0], 'new@co.com');
  assert.equal(notifiedArgs[1], 'Acme');
  assert.match(notifiedArgs[2], /\/invite\//);
  assert.ok(result.tokenHash, 'invitation row should store a token hash');
  assert.notEqual(result.tokenHash.length, 0);
});

test('accept() rejects an already-accepted/revoked/expired invite', async () => {
  const prisma = makePrisma({
    invitation: { findUnique: async () => ({ id: 'inv-1', status: 'REVOKED', expiresAt: new Date(Date.now() + 100000) }) },
  });
  const service = new InvitationsService(prisma, { notifyTeamInvite: async () => {} }, noopAuth());

  await assert.rejects(
    () => service.accept('sometoken', { name: 'A', password: 'password123' }),
    BadRequestException,
  );
});

test('accept() flips an expired-but-still-PENDING invite to EXPIRED on read', async () => {
  let updatedTo = null;
  const prisma = makePrisma({
    invitation: {
      findUnique: async () => ({ id: 'inv-1', status: 'PENDING', expiresAt: new Date(Date.now() - 1000) }),
      update: async (args) => { updatedTo = args.data.status; return args; },
    },
  });
  const service = new InvitationsService(prisma, { notifyTeamInvite: async () => {} }, noopAuth());

  await assert.rejects(() => service.accept('sometoken', { name: 'A', password: 'password123' }));
  assert.equal(updatedTo, 'EXPIRED');
});

test('accept() creates the user with the role from the invitation and logs them in', async () => {
  let createdUserData = null;
  const prisma = makePrisma({
    invitation: {
      findUnique: async () => ({
        id: 'inv-1', organizationId: 'org-1', email: 'invitee@co.com', role: 'EDITOR', status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
      }),
    },
    txClient: {
      user: {
        create: async (args) => { createdUserData = args.data; return { id: 'user-9', ...args.data }; },
      },
      invitation: { update: async () => ({}) },
    },
  });
  let issuedFor = null;
  const service = new InvitationsService(
    prisma,
    { notifyTeamInvite: async () => {} },
    { issueTokensForUser: async (u) => { issuedFor = u; return { accessToken: 'tok', refreshToken: 'ref' }; } },
  );

  await service.accept('sometoken', { name: 'Invitee', password: 'password123' });

  assert.equal(createdUserData.role, 'EDITOR');
  assert.equal(createdUserData.organizationId, 'org-1');
  assert.equal(createdUserData.emailVerified, true);
  assert.equal(issuedFor.role, 'EDITOR');
});

test('UsersService.updateRole blocks demoting the last active owner', async () => {
  const prisma = makePrisma({
    user: {
      findFirst: async () => ({ id: 'owner-1', role: 'OWNER' }),
      count: async () => 0, // no other active owners
    },
  });
  const service = new UsersService(prisma);

  await assert.rejects(
    () => service.updateRole('owner-1', 'ADMIN', 'org-1', 'requester-1'),
    BadRequestException,
  );
});

test('UsersService.updateRole allows demoting an owner when another active owner exists', async () => {
  const prisma = makePrisma({
    user: {
      findFirst: async () => ({ id: 'owner-1', role: 'OWNER' }),
      count: async () => 1, // one other active owner
      update: async (args) => ({ id: 'owner-1', ...args.data }),
    },
  });
  const service = new UsersService(prisma);

  const result = await service.updateRole('owner-1', 'ADMIN', 'org-1', 'requester-1');
  assert.equal(result.role, 'ADMIN');
});

test('UsersService.updateRole refuses to grant OWNER on behalf of someone else', async () => {
  const prisma = makePrisma({ user: { findFirst: async () => ({ id: 'user-2', role: 'EDITOR' }) } });
  const service = new UsersService(prisma);

  await assert.rejects(
    () => service.updateRole('user-2', 'OWNER', 'org-1', 'requester-1'),
    ForbiddenException,
  );
});

test('UsersService.deactivate blocks deactivating your own account', async () => {
  const service = new UsersService(makePrisma());
  await assert.rejects(
    () => service.deactivate('user-1', 'org-1', 'user-1'),
    BadRequestException,
  );
});

test('UsersService.deactivate blocks removing the last active owner', async () => {
  const prisma = makePrisma({
    user: {
      findFirst: async () => ({ id: 'owner-1', role: 'OWNER' }),
      count: async () => 0,
    },
  });
  const service = new UsersService(prisma);

  await assert.rejects(
    () => service.deactivate('owner-1', 'org-1', 'requester-1'),
    BadRequestException,
  );
});
