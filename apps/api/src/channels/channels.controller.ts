import { Body, Controller, Get, Param, Patch, Post, Req, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { ChannelsService } from './channels.service';
import { CreateChannelDto } from './dto/create-channel.dto';

@Controller('channels')
@UseInterceptors(TenantInterceptor)
export class ChannelsController {
  constructor(private channels: ChannelsService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.OWNER) // connecting channels is Admin+ per §9.2
  create(@Body() dto: CreateChannelDto, @Req() req: AuthenticatedRequest) {
    return this.channels.create(dto, req.organizationId, req.user.sub);
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest) {
    return this.channels.findAll(req.organizationId);
  }

  @Patch(':id/disconnect')
  @Roles(UserRole.ADMIN, UserRole.OWNER) // disconnecting channels is Admin+ per §9.2
  disconnect(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    // PR 9: actor id now threaded through for the AuditLog entry.
    return this.channels.disconnect(id, req.organizationId, req.user.sub);
  }
}
