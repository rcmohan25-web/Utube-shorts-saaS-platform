import { Controller, Get, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { AuditLogService } from './audit-log.service';

// PR 11 (§9.4 follow-up). ADMIN+ only — the audit trail can reveal who did
// what to whom (role changes, rejections, revocations), which is more
// sensitive than ordinary content and belongs alongside "Manage billing" /
// "Invite/remove team members" in the §9.2 permission matrix rather than
// being viewable by every authenticated role.
@ApiTags('audit-log')
@Controller('audit-log')
@UseInterceptors(TenantInterceptor)
@Roles(UserRole.ADMIN, UserRole.OWNER)
export class AuditLogController {
  constructor(private auditLog: AuditLogService) {}

  @Get()
  list(
    @Req() req: AuthenticatedRequest,
    @Query('action') action?: string,
    @Query('userId') userId?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.auditLog.query(req.organizationId, {
      action,
      userId,
      resourceType,
      resourceId,
      from,
      to,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('actions')
  distinctActions(@Req() req: AuthenticatedRequest) {
    return this.auditLog.distinctActions(req.organizationId);
  }
}
