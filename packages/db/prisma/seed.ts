import { PrismaClient, UserRole, Plan } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Org',
      slug: 'demo-org',
      plan: Plan.STARTER,
      quotaShortsPerMonth: 50,
    },
  });

  const passwordHash = await hash('password123', 10);

  await prisma.user.upsert({
    where: { email: 'admin@dev.local' },
    update: {},
    create: {
      organizationId: org.id,
      email: 'admin@dev.local',
      passwordHash,
      name: 'Demo Admin',
      role: UserRole.OWNER,
      emailVerified: true,
    },
  });

  console.log('Seeded demo org + admin@dev.local / password123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
