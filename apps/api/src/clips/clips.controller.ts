import { Body, Controller, Param, Patch, Req, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { ClipsService } from './clips.service';
import { RejectClipDto } from './dto/reject-clip.dto';

@Controller('clips')
@UseInterceptors(TenantInterceptor)
export class ClipsController {
  constructor(private clips: ClipsService) {}

  @Patch(':id/approve')
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER) // §9.2
  approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.clips.approve(id, req.organizationId);
  }

  @Patch(':id/reject')
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER)
  reject(@Param('id') id: string, @Body() dto: RejectClipDto, @Req() req: AuthenticatedRequest) {
    return this.clips.reject(id, req.organizationId, dto);
  }
}
