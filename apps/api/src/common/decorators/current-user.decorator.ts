import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUserClaims } from '@shorts/shared';

export type AuthenticatedRequest = Express.Request & {
  user: AuthenticatedUserClaims;
  organizationId: string;
};

// @CurrentUser() user: AuthenticatedUserClaims  — pulls req.user populated by JwtStrategy
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user;
});
