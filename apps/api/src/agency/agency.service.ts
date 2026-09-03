import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { startOfMonth } from 'date-fns';
import { Plan } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateClientOrgDto } from './dto/create-client-org.dto';

function slugify(name: string) {
  return (
    name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') ||
    randomUUID().slice(0, 8)
  );
}

function healthFor(lastActivity: Date | null): 'green' | 'amber' | 'red' {
  if (!lastActivity) return 'red';
  const daysSince = (Date.now() - lastActivity.getTime()) / 86_400_000;
  if (daysSince <= 14) return 'green';
  if (daysSince <= 30) return 'amber';
  return 'red';
}

@Injectable()
export class AgencyService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  // §15.2 "Client sub-organizations: Agency creates and manages child orgs
  // per client." A child starts on STARTER and bills independently — it
  // does NOT inherit the parent's Stripe subscription in this version (see
  // README "Known follow-ups"). parentOrganizationId is the only link; the
  // child is otherwise an ordinary, fully tenant-isolated Organization row,
  // so every existing §9.3 TenantInterceptor / findFirst({ id, organizationId })
  // guarantee applies to it unchanged.
  async createClientOrg(dto: CreateClientOrgDto, parentOrganizationId: string, actorUserId: string) {
    const parent = await this.prisma.client.organization.findUnique({ where: { id: parentOrganizationId } });
    if (!parent) throw new NotFoundException('Parent organization not found');

    const baseSlug = slugify(`${parent.slug}-${dto.name}`);
    let slug = baseSlug;
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (await this.prisma.client.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    const child = await this.prisma.client.organization.create({
      data: {
        name: dto.name,
        slug,
        plan: Plan.STARTER,
        parentOrganizationId,
      },
    });

    await this.auditLog.record({
      organizationId: parentOrganizationId,
      userId: actorUserId,
      action: 'agency.client_created',
      resourceType: 'organization',
      resourceId: child.id,
      metadata: { clientName: dto.name, clientOrgId: child.id },
    });

    return child;
  }

  async listClients(parentOrganizationId: string) {
    return this.prisma.client.organization.findMany({
      where: { parentOrganizationId },
      select: { id: true, name: true, slug: true, plan: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // §15.2 "Agency dashboard: single view of all client orgs — usage,
  // health, Shorts published." Health is a simple, explainable signal
  // (days since last video import) rather than a black-box score, in the
  // same spirit as the runbook's severity levels (§20.8) being plain and
  // legible rather than a computed composite.
  async dashboard(parentOrganizationId: string) {
    const clients = await this.prisma.client.organization.findMany({
      where: { parentOrganizationId },
      orderBy: { createdAt: 'asc' },
    });
    const monthStart = startOfMonth(new Date());

    const rows = await Promise.all(
      clients.map(async (org) => {
        const [shortsPublishedThisMonth, activeChannels, lastVideo] = await Promise.all([
          this.prisma.client.usageEvent.count({
            where: { organizationId: org.id, eventType: 'SHORT_PUBLISHED', createdAt: { gte: monthStart } },
          }),
          this.prisma.client.channel.count({ where: { organizationId: org.id, isActive: true } }),
          this.prisma.client.video.findFirst({
            where: { organizationId: org.id },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          }),
        ]);

        return {
          id: org.id,
          name: org.name,
          slug: org.slug,
          plan: org.plan,
          quotaShortsPerMonth: org.quotaShortsPerMonth,
          shortsPublishedThisMonth,
          activeChannels,
          lastActivityAt: lastVideo?.createdAt ?? null,
          health: healthFor(lastVideo?.createdAt ?? null),
        };
      }),
    );

    return {
      clientCount: clients.length,
      totalShortsPublishedThisMonth: rows.reduce((sum, r) => sum + r.shortsPublishedThisMonth, 0),
      clients: rows,
    };
  }
}
