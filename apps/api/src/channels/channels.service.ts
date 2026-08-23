import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateChannelDto } from './dto/create-channel.dto';

@Injectable()
export class ChannelsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
  ) {}

  create(dto: CreateChannelDto, organizationId: string, userId: string) {
    return this.prisma.client.channel.create({
      data: { ...dto, organizationId, userId },
    });
  }

  findAll(organizationId: string) {
    return this.prisma.client.channel.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Soft-disconnect: keep history/Shorts attached to the channel, just stop
  // routing new pipeline activity to it. Re-running the OAuth connect flow
  // flips isActive back to true (see YoutubeOAuthService.handleCallback).
  //
  // PR 9 (Security Hardening, §9.4/§20.13): destructive action, so it's
  // recorded to AuditLog. Tenant-scoped findFirst below is what makes this
  // safe against IDOR — see apps/api/test/tenant-isolation.test.js.
  async disconnect(id: string, organizationId: string, actorUserId: string) {
    const channel = await this.prisma.client.channel.findFirst({ where: { id, organizationId } });
    if (!channel) throw new NotFoundException('Channel not found');

    const updated = await this.prisma.client.channel.update({
      where: { id },
      data: { isActive: false },
    });

    await this.auditLog.record({
      organizationId,
      userId: actorUserId,
      action: 'channel.disconnect',
      resourceType: 'channel',
      resourceId: id,
      metadata: { youtubeChannelId: channel.youtubeChannelId, name: channel.name },
    });

    return updated;
  }
}
