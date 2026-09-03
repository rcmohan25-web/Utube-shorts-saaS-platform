import { Body, Controller, Get, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { Feature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { AgencyService } from './agency.service';
import { CreateClientOrgDto } from './dto/create-client-org.dto';

// §15.2 Phase 6. Every route treats the CALLER's org as the parent —
// parentOrganizationId is never taken from the request body, so a client
// org can never see or manage its parent's (or a sibling's) data.
@Controller('agency')
@UseInterceptors(TenantInterceptor)
@UseGuards(FeatureGuard)
@Feature('AGENCY_SUB_ORGS')
export class AgencyController {
  constructor(private agency: AgencyService) {}

  @Post('clients')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  createClient(@Body() dto: CreateClientOrgDto, @Req() req: AuthenticatedRequest) {
    return this.agency.createClientOrg(dto, req.organizationId, req.user.sub);
  }

  @Get('clients')
  listClients(@Req() req: AuthenticatedRequest) {
    return this.agency.listClients(req.organizationId);
  }

  @Get('dashboard')
  dashboard(@Req() req: AuthenticatedRequest) {
    return this.agency.dashboard(req.organizationId);
  }
}
