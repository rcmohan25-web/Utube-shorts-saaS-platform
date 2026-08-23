import {
  Body,
  Controller,
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
import { Throttle } from '@nestjs/throttler';
import { UserRole, VideoStatus } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import { InternalSecretGuard } from '../common/guards/internal-secret.guard';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { VideosService } from './videos.service';
import { ImportVideoDto } from './dto/import-video.dto';
import { VideoStatusCallbackDto } from './dto/video-status-callback.dto';
import { ClipsService } from '../clips/clips.service';
import { CreateClipsDto } from '../clips/dto/create-clips.dto';

@ApiTags('videos')
@Controller('videos')
@UseInterceptors(TenantInterceptor)
export class VideosController {
  constructor(
    private videos: VideosService,
    private clips: ClipsService,
  ) {}

  @Post()
  @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER)
  @HttpCode(HttpStatus.CREATED)
  importVideo(@Body() dto: ImportVideoDto, @Req() req: AuthenticatedRequest) {
    return this.videos.importVideo(dto, req.organizationId, req.user.sub);
  }

  @Get()
  findAll(@Req() req: AuthenticatedRequest, @Query('status') status?: VideoStatus) {
    return this.videos.findAll(req.organizationId, status);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.videos.findOne(id, req.organizationId);
  }

  // Worker -> API callback. Public to the JWT guard, but locked down by
  // InternalSecretGuard.
  //
  // PR 9 (Security Hardening, §19.1): explicit 'internal' throttle bucket
  // (300/min, see app.module.ts) instead of the default 100/min user-facing
  // limit. Every download/transcription/clip-detection stage PATCHes this
  // route, so a normal burst of parallel video imports can legitimately
  // exceed the default limit; the internal bucket is deliberately generous
  // while still capping a runaway retry storm or a brute-force attempt
  // against API_INTERNAL_SECRET.
  @Throttle({ internal: { limit: 300, ttl: 60_000 } })
  @Public()
  @UseGuards(InternalSecretGuard)
  @Patch(':id/status')
  applyStatusCallback(@Param('id') id: string, @Body() dto: VideoStatusCallbackDto) {
    return this.videos.applyStatusCallback(id, dto);
  }

  // clip-worker -> API callback after GPT-4o scoring (§6.2). Lives here
  // (rather than on ClipsController) since the URL is a sub-resource of
  // /videos; ClipsService itself stays in the clips module.
  @Throttle({ internal: { limit: 300, ttl: 60_000 } })
  @Public()
  @UseGuards(InternalSecretGuard)
  @Post(':id/clips')
  createClips(@Param('id') id: string, @Body() dto: CreateClipsDto) {
    return this.clips.createFromWorker(id, dto);
  }
}
