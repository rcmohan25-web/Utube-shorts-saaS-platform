import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApiKeyScope } from '@shorts/db';
import { Public } from '../common/decorators/public.decorator';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ApiKeyScopeGuard } from '../common/guards/api-key-scope.guard';
import { RequireScope } from '../common/decorators/require-scope.decorator';
import { VideosService } from '../videos/videos.service';
import { ImportVideoDto } from '../videos/dto/import-video.dto';

type ApiKeyRequest = Request & { organizationId: string; apiKeyId: string; apiKeyScope: ApiKeyScope };

// §15.2 "REST API with org-scoped API keys for external integrations."
// @Public() bypasses the JWT guard chain entirely — ApiKeyGuard is the
// real gate here, an intentionally separate trust boundary from user
// sessions (mirrors how the Stripe webhook trusts a signature instead of
// a JWT, §9.4).
//
// PR 14 (§15.2 follow-up):
//   - ApiKeyScopeGuard is now also registered here, AFTER ApiKeyGuard in
//     the array. Guard order within one @UseGuards() call is execution
//     order in Nest, so ApiKeyGuard's req.apiKeyScope assignment always
//     happens before ApiKeyScopeGuard reads it.
//   - @RequireScope(READ_WRITE) marks the one route that mutates data;
//     the GET route is unmarked and therefore callable by a READ_ONLY
//     key too.
//   - Rate limiting for this whole controller is now tracked per API key
//     rather than per IP — see ApiKeyThrottlerGuard, registered globally
//     in app.module.ts. No change needed here: the
//     @Throttle({ external: ... }) bucket assignment is unchanged, only
//     *what identifies a caller* within that bucket changed.
@Controller('public/v1')
@Public()
@UseGuards(ApiKeyGuard, ApiKeyScopeGuard)
export class PublicApiController {
  constructor(private videos: VideosService) {}

  // §19.1-style dedicated bucket: external callers get their own ceiling,
  // separate from our own workers' 'internal' bucket and from user-facing
  // 'default'.
  @Throttle({ external: { limit: 120, ttl: 60_000 } })
  @RequireScope(ApiKeyScope.READ_WRITE) // PR 14: importing a video writes data — a READ_ONLY key is rejected
  @Post('videos')
  importVideo(@Body() dto: ImportVideoDto, @Req() req: ApiKeyRequest) {
    // No human user in this flow — the resulting UsageEvent(VIDEO_IMPORTED)
    // row gets a synthetic 'api-key:<id>' marker instead of a real userId
    // (UsageEvent.userId has no FK constraint) so it's still attributable
    // in an audit query.
    return this.videos.importVideo(dto, req.organizationId, `api-key:${req.apiKeyId}`);
  }

  // No @RequireScope() — callable by both READ_ONLY and READ_WRITE keys.
  @Throttle({ external: { limit: 120, ttl: 60_000 } })
  @Get('videos')
  listVideos(@Req() req: ApiKeyRequest, @Query('status') status?: string) {
    return this.videos.findAll(req.organizationId, status as never);
  }
}
