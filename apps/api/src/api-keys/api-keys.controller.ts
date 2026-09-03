import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { Feature } from '../common/decorators/feature.decorator';
import { FeatureGuard } from '../common/guards/feature.guard';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('organizations/api-keys')
@UseInterceptors(TenantInterceptor)
@UseGuards(FeatureGuard)
@Feature('API_ACCESS')
export class ApiKeysController {
  constructor(private apiKeys: ApiKeysService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body() dto: CreateApiKeyDto, @Req() req: AuthenticatedRequest) {
    return this.apiKeys.create(dto, req.organizationId, req.user.sub);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  list(@Req() req: AuthenticatedRequest) {
    return this.apiKeys.list(req.organizationId);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  revoke(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.apiKeys.revoke(id, req.organizationId, req.user.sub);
  }
}
