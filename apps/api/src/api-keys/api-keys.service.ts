import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { ApiKeyStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

const KEY_PREFIX = 'sk_live_';

function hashKey(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  // §15.2 "REST API with org-scoped API keys." The raw key is returned
  // exactly once, here — only its hash and a short display prefix are ever
  // persisted, same one-time-reveal discipline as every other secret
  // issuance flow in this codebase (§9.1's OAuth tokens are never
  // re-displayed either).
  async create(dto: CreateApiKeyDto, organizationId: string, actorUserId: string) {
    const secret = randomBytes(24).toString('hex'); // 48 hex chars
    const rawKey = `${KEY_PREFIX}${secret}`;
    const keyPrefix = rawKey.slice(0, 16); // enough to recognize in a UI list, not enough to brute-force

    const created = await this.prisma.client.apiKey.create({
      data: {
        organizationId,
        name: dto.name,
        keyPrefix,
        keyHash: hashKey(rawKey),
        createdByUserId: actorUserId,
      },
    });

    await this.auditLog.record({
      organizationId,
      userId: actorUserId,
      action: 'apikey.created',
      resourceType: 'apiKey',
      resourceId: created.id,
      metadata: { name: dto.name, keyPrefix },
    });

    return { id: created.id, name: created.name, keyPrefix, rawKey, createdAt: created.createdAt };
  }

  async list(organizationId: string) {
    return this.prisma.client.apiKey.findMany({
      where: { organizationId },
      select: {
        id: true, name: true, keyPrefix: true, status: true,
        lastUsedAt: true, revokedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string, organizationId: string, actorUserId: string) {
    const key = await this.prisma.client.apiKey.findFirst({ where: { id, organizationId } });
    if (!key) throw new NotFoundException('API key not found');
    if (key.status === ApiKeyStatus.REVOKED) {
      throw new BadRequestException('This API key is already revoked');
    }

    const updated = await this.prisma.client.apiKey.update({
      where: { id },
      data: { status: ApiKeyStatus.REVOKED, revokedAt: new Date() },
    });

    await this.auditLog.record({
      organizationId,
      userId: actorUserId,
      action: 'apikey.revoked',
      resourceType: 'apiKey',
      resourceId: id,
      metadata: { name: key.name },
    });

    return updated;
  }

  // Used by ApiKeyGuard on the public API. Best-effort lastUsedAt write —
  // never lets a logging failure block the caller's actual request.
  async resolve(rawKey: string) {
    const record = await this.prisma.client.apiKey.findUnique({ where: { keyHash: hashKey(rawKey) } });
    if (!record || record.status === ApiKeyStatus.REVOKED) return null;

    this.prisma.client.apiKey
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});

    return record;
  }
}
