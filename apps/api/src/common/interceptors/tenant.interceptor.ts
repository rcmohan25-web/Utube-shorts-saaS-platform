import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';

// Per §9.3: attaches organizationId from the verified JWT onto the request,
// so every service method has one canonical source for tenant scoping.
// NEVER trust an orgId from the request body/query — always from req.organizationId.
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (req.user?.orgId) {
      req.organizationId = req.user.orgId;
    }
    return next.handle();
  }
}
