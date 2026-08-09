import { Controller, Get, Param, Patch, Req, UseInterceptors } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseInterceptors(TenantInterceptor)
export class NotificationsController {
  constructor(private prisma: PrismaService) {}

  // No @Roles() — any authenticated org member can see and clear their org's feed.
  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.prisma.client.notification.findMany({
      where: { organizationId: req.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.prisma.client.notification.updateMany({
      where: { id, organizationId: req.organizationId },
      data: { readAt: new Date() },
    });
  }
}
