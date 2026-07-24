import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserRole } from '@shorts/db';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { SchedulesService } from './schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';

// Internal-only DTOs — kept inline since they're only used here
class CompleteCallbackDto {
  youtubeVideoId!: string;
  organizationId!: string;
}

class FailedCallbackDto {
  errorMessage!: string;
  organizationId!: string;
}

class QuotaExceededCallbackDto {
  organizationId!: string;
}

@ApiTags('schedules')
@Controller('schedules')
export class SchedulesController {
  constructor(private schedules: SchedulesService) {}

  // ── User-facing ─────────────────────────────────────────────────────────

  @Post()
  @UseInterceptors(TenantInterceptor)
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER) // §9.2
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateScheduleDto, @Req() req: AuthenticatedRequest) {
    return this.schedules.create(dto, req.organizationId, req.user.sub);
  }

  @Get()
  @UseInterceptors(TenantInterceptor)
  findAll(
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channelId') channelId?: string,
  ) {
    return this.schedules.findAll(req.organizationId, from, to, channelId);
  }

  @Delete(':id')
  @UseInterceptors(TenantInterceptor)
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.schedules.cancel(id, req.organizationId);
  }

  // ── Internal worker callbacks — no JWT, locked by InternalSecretGuard ───
  //
  // Three separate endpoints rather than one PATCH /schedules/:id/status
  // because each has a different payload shape and different service logic.
  // Keeping them separate makes the controller readable and the service
  // methods independently testable.

  @Public()
  @UseGuards(InternalSecretGuard)
  @Patch(':id/complete')
  complete(@Param('id') id: string, @Body() body: CompleteCallbackDto) {
    return this.schedules.markPublished(id, body.organizationId, body.youtubeVideoId);
  }

  @Public()
  @UseGuards(InternalSecretGuard)
  @Patch(':id/failed')
  failed(@Param('id') id: string, @Body() body: FailedCallbackDto) {
    return this.schedules.markFailed(id, body.organizationId, body.errorMessage);
  }

  // Quota exceeded is per-schedule (the failing schedule ID identifies
  // which channel hit the limit), not per-channel — the service handles
  // the cascade to all pending schedules for that channel.
  @Public()
  @UseGuards(InternalSecretGuard)
  @Patch(':id/quota-exceeded')
  quotaExceeded(@Param('id') id: string, @Body() body: QuotaExceededCallbackDto) {
    return this.schedules.postponeForQuota(id, body.organizationId);
  }
}
