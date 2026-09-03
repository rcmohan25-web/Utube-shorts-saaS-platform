import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeysService } from '../../api-keys/api-keys.service';

// Authenticates the §15.2 public/external-integration API. Distinct from
// JwtAuthGuard: no user session, no WebSocket org-room join — just
// "Authorization: Bearer sk_live_..." resolving straight to an
// organizationId, attached onto the request the same way TenantInterceptor
// attaches it for JWT-authenticated routes so downstream services never
// need to know which auth mechanism was used.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'] as string | undefined;
    const rawKey = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!rawKey || !rawKey.startsWith('sk_live_')) {
      throw new UnauthorizedException('Missing or malformed API key — expected Authorization: Bearer sk_live_...');
    }

    const record = await this.apiKeys.resolve(rawKey);
    if (!record) throw new UnauthorizedException('Invalid or revoked API key');

    req.organizationId = record.organizationId;
    req.apiKeyId = record.id;
    return true;
  }
}
