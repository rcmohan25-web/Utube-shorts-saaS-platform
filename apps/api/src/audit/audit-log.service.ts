import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// §9.4 / §20.13 code review checklist: "every destructive action appended
// immutably to audit_logs (never updated)." The AuditLog table has existed
// in the schema since the very first migration (§5.1) — this service is
// what finally writes to it (PR 9), extended with more actions (PR 10),
// and now reads it back for the admin UI (PR 11).
export type AuditAction =
  | 'channel.disconnect'
  | 'clip.reject'
  | 'short.reject'
  | 'schedule.cancel'
  | 'user.role_changed'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'invitation.revoked'
  | 'organization.branding_updated'
  // PR 10 (§15.2 Agency White-Label)
  | 'agency.client_created'
  | 'apikey.created'
  | 'apikey.revoked';

export type AuditLogEntry = {
  organizationId: string;
  userId?: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

// PR 11 (§9.4 follow-up: "Audit log admin UI").
export type AuditLogQuery = {
  action?: string;
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  from?: string; // ISO date, inclusive
  to?: string; // ISO date, inclusive
  cursor?: string; // AuditLog.id of the last row from the previous page
  limit?: number;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  // Deliberately does NOT catch/swallow errors the way NotificationsService
  // does for email/Slack. A notification that silently fails to send is a
  // UX gap; an audit entry that silently fails to write is a compliance
  // gap — the caller should see the failure, not a false sense of an audit
  // trail. Rows are append-only: nothing in this codebase calls
  // auditLog.update() or .delete() — see §20.13's checklist line item.
  async record(entry: AuditLogEntry): Promise<void> {
    await this.prisma.client.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        userId: entry.userId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        metadata: (entry.metadata ?? null) as never,
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }

  // PR 11: cursor-based pagination per §8.1's convention ("cursor-based
  // for large sets") — an org's audit trail only grows, so offset
  // pagination would get slower and less stable (rows shifting under a
  // page boundary) the longer the org has been live. Cursor = the last
  // row's id; `take: limit + 1` is the standard "peek one extra row to
  // know if there's a next page" trick.
  async query(organizationId: string, filters: AuditLogQuery) {
    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);

    const where = {
      organizationId, // tenant-scoped — same mandatory rule as every other query in this codebase (§9.3)
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
      ...(filters.resourceId ? { resourceId: filters.resourceId } : {}),
      ...(filters.from || filters.to
        ? {
            createdAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const rows = await this.prisma.client.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return { items, nextCursor };
  }

  // Powers the admin UI's action-type filter dropdown when the frontend
  // wants server-confirmed values instead of the static shared list (e.g.
  // to hide actions this org has never actually triggered).
  async distinctActions(organizationId: string): Promise<string[]> {
    const rows = await this.prisma.client.auditLog.findMany({
      where: { organizationId },
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
    });
    return rows.map((r) => r.action);
  }
}
