import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

// Used on worker→API callback routes (e.g. PATCH /videos/:id/status).
// These are NOT user-authenticated — Python workers call back with a shared secret,
// per §12.1 API_INTERNAL_SECRET. Keep this guard OUT of the global JWT guard chain
// by registering the route with @Public() and applying this guard directly.
@Injectable()
export class InternalSecretGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const provided = req.headers['x-internal-secret'];
    if (!provided || provided !== process.env.API_INTERNAL_SECRET) {
      throw new UnauthorizedException('Invalid internal secret');
    }
    return true;
  }
}
