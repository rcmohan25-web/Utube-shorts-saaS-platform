import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { UpdateOrganizationBrandingDto } from './dto/update-organization-branding.dto';

@Injectable()
export class OrganizationsService {
  constructor(private prisma: PrismaService) {}

  async updateBranding(organizationId: string, dto: UpdateOrganizationBrandingDto) {
    const organization = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.prisma.client.organization.update({
      where: { id: organizationId },
      data: { webhookUrl: dto.webhookUrl ?? organization.webhookUrl },
    });
  }
}
