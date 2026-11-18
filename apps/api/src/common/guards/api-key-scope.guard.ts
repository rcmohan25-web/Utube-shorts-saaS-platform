import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyScope } from '@shorts/db';
import { REQUIRE_SCOPE_KEY } from '../decorators/require-scope.decorator';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';

// PR 14 (§15.2 follow-up: per-API-key scoping). Runs immediately after
// ApiKeyGuard on PublicApiController — guard order within a single
// @UseGuards() call is execution order in Nest, and ApiKeyGuard is
// listed first there specifically so req.apiKeyScope is already
// populated by the time this guard reads it.
//
// Distinct from RolesGuard's JWT-based RBAC (§9.2) — this is a separate,
// API-key-specific trust boundary: a READ_ONLY key authenticates fine
// (ApiKeyGuard passes) but is blocked here from any route marked
// @RequireScope(READ_WRITE).
@Injectable()
export class ApiKeyScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<ApiKeyScope>(REQUIRE_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true; // no @RequireScope() -> callable by any valid key

    const req = context.switchToHttp().getRequest() as AuthenticatedRequest & { apiKeyScope?: ApiKeyScope };
    const actual = req.apiKeyScope;

    // READ_WRITE satisfies any requirement — including a hypothetical
    // READ_ONLY requirement, though nothing in this codebase declares
    // one today (every route is either unscoped or @RequireScope(WRITE)).
    if (actual === ApiKeyScope.READ_WRITE) return true;
    if (actual === required) return true;

    throw new ForbiddenException(
      `This API key is scoped to ${actual ?? 'unknown'} and cannot call a ${required}-scoped endpoint. ` +
        'Issue a Read/Write key from /settings/api-keys if this integration needs to write data.',
    );
  }
}
