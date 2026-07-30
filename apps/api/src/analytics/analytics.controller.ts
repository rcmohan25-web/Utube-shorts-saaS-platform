import { Controller, Get, NotFoundException, Param, Query, Req, UseInterceptors } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { AnalyticsService } from './analytics.service';

// Default window: last 7 days, matching /dashboard's default (§11.1) —
// callers pass ?from=&to= for the 7d/30d/90d/custom presets on §11.5.
function parseRange(from?: string, to?: string) {
  const toDate = to ? new Date(to) : new Date();
  const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { fromDate, toDate };
}

@ApiTags('analytics')
@Controller('analytics')
@UseInterceptors(TenantInterceptor)
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  // No @Roles() decorator: analytics is view-only for every authenticated
  // role (VIEWER+), per the §9.2 RBAC matrix — "View analytics" is the one
  // row where all four roles are checked.
  @Get('overview')
  overview(@Req() req: AuthenticatedRequest, @Query('from') from?: string, @Query('to') to?: string) {
    const { fromDate, toDate } = parseRange(from, to);
    return this.analytics.overview(req.organizationId, fromDate, toDate);
  }

  @Get('shorts/:id')
  async shortSeries(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { fromDate, toDate } = parseRange(from, to);
    const result = await this.analytics.shortSeries(id, req.organizationId, fromDate, toDate);
    if (!result) throw new NotFoundException('Short not found');
    return result;
  }
}
