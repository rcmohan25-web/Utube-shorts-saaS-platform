import { Injectable, NotFoundException } from '@nestjs/common';
import { ShortStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VideoGateway } from '../websockets/video.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateShortDto } from './dto/create-short.dto';
import { RejectShortDto } from './dto/reject-short.dto';
import { transitionShort } from './short-status.machine';

@Injectable()
export class ShortsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private videoGateway: VideoGateway,
    private notifications: NotificationsService,
    private auditLog: AuditLogService,
  ) {}

  // Worker -> API callback (render-worker). Always a create — see
  // short-status.machine.ts's comment for why.
  async createFromWorker(dto: CreateShortDto) {
    const clip = await this.prisma.client.clip.findFirst({
      where: { id: dto.clipId, organizationId: dto.organizationId },
    });
    if (!clip) throw new NotFoundException('Clip not found for this short');

    const short = await this.prisma.client.short.create({
      data: {
        id: dto.shortId,
        organizationId: dto.organizationId,
        clipId: dto.clipId,
        channelId: dto.channelId,
        title: dto.title,
        tags: dto.tags ?? [],
        status: dto.status === 'REVIEW' ? ShortStatus.REVIEW : ShortStatus.FAILED,
        renderS3Key: dto.renderS3Key,
        thumbnailS3Key: dto.thumbnailS3Key,
        captionS3Key: dto.captionS3Key,
        errorMessage: dto.errorMessage,
        renderEnded: new Date(),
      },
    });

    if (short.status === ShortStatus.REVIEW) {
      const thumbnailUrl = short.thumbnailS3Key ? await this.storage.getPresignedUrl(short.thumbnailS3Key) : null;
      this.videoGateway.emitShortReady(dto.organizationId, {
        shortId: short.id,
        thumbnailUrl: thumbnailUrl ?? '',
      });
      // §15.1 "Shorts ready for review" — batched (max 1 email/hour) inside
      // NotificationsService.notify(); safe to call once per render here.
      await this.notifications.notify('SHORTS_READY', dto.organizationId, {});
    } else {
      // §15.1 "Pipeline failure" — render-worker reported FAILED.
      await this.notifications.notify('PIPELINE_FAILURE', dto.organizationId, {
        resourceType: 'short',
        resourceId: short.id,
        reason: dto.errorMessage ?? 'Render pipeline failed — check render-worker logs.',
      });
    }

    return short;
  }

  async findAll(organizationId: string, status?: ShortStatus) {
    return this.prisma.client.short.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { clip: true, channel: true },
    });
  }

  async findOne(id: string, organizationId: string) {
    const short = await this.prisma.client.short.findFirst({
      where: { id, organizationId },
      include: { clip: true, channel: true },
    });
    if (!short) throw new NotFoundException('Short not found');

    // §9.4: never return a raw S3 key — only ever a presigned URL.
    const renderPresignedUrl = short.renderS3Key ? await this.storage.getPresignedUrl(short.renderS3Key) : null;
    const thumbnailPresignedUrl = short.thumbnailS3Key
      ? await this.storage.getPresignedUrl(short.thumbnailS3Key)
      : null;

    return { ...short, renderPresignedUrl, thumbnailPresignedUrl };
  }

  async approve(id: string, organizationId: string, reviewedBy: string) {
    return transitionShort(this.prisma, id, organizationId, ShortStatus.APPROVED, {
      reviewedBy,
      reviewedAt: new Date(),
    });
  }

  // Destructive: discards a rendered Short. Audit-logged per §20.13
  // (PR 9, Security Hardening).
  async reject(id: string, organizationId: string, reviewedBy: string, dto: RejectShortDto) {
    const updated = await transitionShort(this.prisma, id, organizationId, ShortStatus.REJECTED, {
      reviewedBy,
      reviewedAt: new Date(),
      rejectionReason: dto.reason ?? null,
    });

    await this.auditLog.record({
      organizationId,
      userId: reviewedBy,
      action: 'short.reject',
      resourceType: 'short',
      resourceId: id,
      metadata: { reason: dto.reason ?? null },
    });

    return updated;
  }
}
