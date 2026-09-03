import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FLAGS, type FeatureFlagName } from '@shorts/shared';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';

// Runs after the global JwtAuthGuard, so req.user.plan is already populated
// straight from the JWT claims (§9.1) — no DB hit. A Stripe-triggered plan
// change takes up to 15 minutes (the access-token TTL) to be reflected
// here, the same staleness window already accepted throughout §9/§13.
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const flag = this.reflector.getAllAndOverride<FeatureFlagName>(FEATURE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!flag) return true; // no @Feature() on this route -> not gated

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!FLAGS[flag](req.user.plan)) {
      throw new ForbiddenException(
        `This feature ('${flag}') requires the Agency plan or higher. Upgrade from Billing to unlock it.`,
      );
    }
    return true;
  }
}
