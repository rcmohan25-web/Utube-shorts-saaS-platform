import { Body, Controller, Put, Req, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationBrandingDto } from './dto/update-organization-branding.dto';

@Controller('organizations')
@UseInterceptors(TenantInterceptor)
export class OrganizationsController {
  constructor(private organizations: OrganizationsService) {}

  @Put('branding')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  updateBranding(@Body() dto: UpdateOrganizationBrandingDto, @Req() req: AuthenticatedRequest) {
    return this.organizations.updateBranding(req.organizationId, dto);
  }
}
