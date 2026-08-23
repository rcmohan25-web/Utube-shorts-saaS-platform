import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShortStatus, UserRole } from '@shorts/db';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { ShortsService } from './shorts.service';
import { CreateShortDto } from './dto/create-short.dto';
import { RejectShortDto } from './dto/reject-short.dto';

@Controller('shorts')
export class ShortsController {
  constructor(private shorts: ShortsService) {}

  // render-worker -> API callback. Always creates the row — see ShortsService.
  // PR 9 (§19.1): 'internal' throttle bucket, see SchedulesController for
  // the rationale (bursty legitimate traffic, brute-force resistance).
  @Throttle({ internal: { limit: 300, ttl: 60_000 } })
  @Public()
  @UseGuards(InternalSecretGuard)
  @Post()
  createFromWorker(@Body() dto: CreateShortDto) {
    return this.shorts.createFromWorker(dto);
  }

  @Get()
  @UseInterceptors(TenantInterceptor)
  findAll(@Req() req: AuthenticatedRequest, @Query('status') status?: ShortStatus) {
    return this.shorts.findAll(req.organizationId, status);
  }

  @Get(':id')
  @UseInterceptors(TenantInterceptor)
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.shorts.findOne(id, req.organizationId);
  }

  @Patch(':id/approve')
  @UseInterceptors(TenantInterceptor)
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER) // §9.2
  approve(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.shorts.approve(id, req.organizationId, req.user.sub);
  }

  @Patch(':id/reject')
  @UseInterceptors(TenantInterceptor)
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER)
  reject(@Param('id') id: string, @Body() dto: RejectShortDto, @Req() req: AuthenticatedRequest) {
    return this.shorts.reject(id, req.organizationId, req.user.sub, dto);
  }
}
