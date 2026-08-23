import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// §9.4 / §20.13 code review checklist: "every destructive action appended
// immutably to audit_logs (never updated)." The AuditLog table has existed
// in the schema since the very first migration (§5.1) — this service is
// what finally writes to it. PR 9 (Security Hardening).
export type AuditAction =
  | 'channel.disconnect'
  | 'clip.reject'
  | 'short.reject'
  | 'schedule.cancel'
  | 'user.role_changed'
  | 'user.deactivated'
  | 'user.reactivated'
  | 'invitation.revoked'
  | 'organization.branding_updated';

export type AuditLogEntry = {
  organizationId: string;
  userId?: string | null;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
};

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
}
