import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import type { UpdateOrganizationBrandingDto } from './dto/update-organization-branding.dto';

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  async updateBranding(organizationId: string, dto: UpdateOrganizationBrandingDto, actorUserId: string) {
    const organization = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.prisma.client.organization.update({
      where: { id: organizationId },
      data: { webhookUrl: dto.webhookUrl ?? organization.webhookUrl },
    });

    await this.auditLog.record({
      organizationId,
      userId: actorUserId,
      action: 'organization.branding_updated',
      resourceType: 'organization',
      resourceId: organizationId,
      metadata: { webhookUrlChanged: dto.webhookUrl !== undefined },
    });

    return updated;
  }
}
