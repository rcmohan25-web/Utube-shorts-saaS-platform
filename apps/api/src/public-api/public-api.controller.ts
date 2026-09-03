import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { VideosService } from '../videos/videos.service';
import { ImportVideoDto } from '../videos/dto/import-video.dto';

type ApiKeyRequest = Request & { organizationId: string; apiKeyId: string };

// §15.2 "REST API with org-scoped API keys for external integrations."
// @Public() bypasses the JWT guard chain entirely — ApiKeyGuard is the
// real gate here, an intentionally separate trust boundary from user
// sessions (mirrors how the Stripe webhook trusts a signature instead of
// a JWT, §9.4).
@Controller('public/v1')
@Public()
@UseGuards(ApiKeyGuard)
export class PublicApiController {
  constructor(private videos: VideosService) {}

  // §19.1-style dedicated bucket: external callers get their own ceiling,
  // separate from our own workers' 'internal' bucket and from user-facing
  // 'default'. Nest's throttler is per-IP by default — tracking per API
  // key is a known follow-up (see README).
  @Throttle({ external: { limit: 120, ttl: 60_000 } })
  @Post('videos')
  importVideo(@Body() dto: ImportVideoDto, @Req() req: ApiKeyRequest) {
    // No human user in this flow — the resulting UsageEvent(VIDEO_IMPORTED)
    // row gets a synthetic 'api-key:<id>' marker instead of a real userId
    // (UsageEvent.userId has no FK constraint) so it's still attributable
    // in an audit query.
    return this.videos.importVideo(dto, req.organizationId, `api-key:${req.apiKeyId}`);
  }

  @Get('videos')
  listVideos(@Req() req: ApiKeyRequest, @Query('status') status?: string) {
    return this.videos.findAll(req.organizationId, status as never);
  }
}
