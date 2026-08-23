import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { ClipStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queues/queue.module';
import { VideoGateway } from '../websockets/video.gateway';
import { AuditLogService } from '../audit/audit-log.service';
import { CreateClipsDto } from './dto/create-clips.dto';
import { RejectClipDto } from './dto/reject-clip.dto';

@Injectable()
export class ClipsService {
  constructor(
    private prisma: PrismaService,
    private videoGateway: VideoGateway,
    @InjectQueue(QUEUE_NAMES.RENDER) private renderQueue: Queue,
    private auditLog: AuditLogService,
  ) {}

  // Internal callback from clip-worker (§6.2) — bulk-creates the top-N
  // scored clips for a video and pushes a clip:created event per row (§8.3).
  async createFromWorker(videoId: string, dto: CreateClipsDto) {
    const video = await this.prisma.client.video.findFirst({
      where: { id: videoId, organizationId: dto.organizationId },
    });
    if (!video) throw new NotFoundException('Video not found');

    const created = [];
    for (const candidate of dto.clips) {
      const clip = await this.prisma.client.clip.create({
        data: {
          organizationId: dto.organizationId,
          videoId,
          startSeconds: candidate.startSeconds,
          endSeconds: candidate.endSeconds,
          durationSeconds: candidate.endSeconds - candidate.startSeconds,
          confidenceScore: candidate.confidenceScore,
          transcriptSegment: candidate.transcriptSegment,
          aiReasoning: candidate.aiReasoning,
          suggestedTitle: candidate.suggestedTitle,
          suggestedHashtags: candidate.suggestedHashtags ?? [],
        },
      });

      this.videoGateway.emitClipCreated(dto.organizationId, {
        videoId,
        clipId: clip.id,
        score: clip.confidenceScore,
      });
      created.push(clip);
    }
    return created;
  }

  // §8.2: Approve -> triggers render job (EDITOR+). Pre-generates the
  // Short's id so the S3 render path (renders/{shortId}/...) is known up
  // front — render-worker creates the Short row at the very end (success or
  // failure) via POST /shorts, reusing this same id. See PR-03-NOTES.md for
  // why the id has to be generated here rather than after rendering.
  async approve(clipId: string, organizationId: string) {
    const clip = await this.prisma.client.clip.findFirst({
      where: { id: clipId, organizationId },
      include: { video: true },
    });
    if (!clip) throw new NotFoundException('Clip not found');
    if (clip.status !== ClipStatus.PENDING) {
      throw new BadRequestException(`Clip is already ${clip.status.toLowerCase()}`);
    }
    if (!clip.video.rawVideoS3Key || !clip.video.transcriptS3Key) {
      throw new BadRequestException('Video is missing raw footage or transcript — cannot render yet');
    }

    await this.prisma.client.clip.update({
      where: { id: clipId },
      data: { status: ClipStatus.APPROVED },
    });

    const shortId = randomUUID();
    await this.renderQueue.add(
      'render',
      { shortId, clipId, organizationId },
      { jobId: `render_${shortId}`, attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
    );

    return { clipId, shortId, status: 'RENDERING' };
  }

  // Destructive: discards the clip candidate. Audit-logged per §20.13's
  // "every destructive action appended immutably to audit_logs" rule
  // (PR 9, Security Hardening).
  async reject(clipId: string, organizationId: string, dto: RejectClipDto, actorUserId: string) {
    const clip = await this.prisma.client.clip.findFirst({ where: { id: clipId, organizationId } });
    if (!clip) throw new NotFoundException('Clip not found');

    const updated = await this.prisma.client.clip.update({
      where: { id: clipId },
      data: { status: ClipStatus.REJECTED, rejectionReason: dto.reason ?? null },
    });

    await this.auditLog.record({
      organizationId,
      userId: actorUserId,
      action: 'clip.reject',
      resourceType: 'clip',
      resourceId: clipId,
      metadata: { reason: dto.reason ?? null },
    });

    return updated;
  }
}
