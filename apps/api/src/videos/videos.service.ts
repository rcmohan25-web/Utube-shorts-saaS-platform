import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventType, VideoStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queues/queue.module';
import { YoutubeService, extractYoutubeId } from '../youtube/youtube.service';
import { ImportVideoDto } from './dto/import-video.dto';
import { VideoStatusCallbackDto } from './dto/video-status-callback.dto';
import { transitionVideo } from './video-status.machine';

@Injectable()
export class VideosService {
  constructor(
    private prisma: PrismaService,
    private youtube: YoutubeService,
    @InjectQueue(QUEUE_NAMES.VIDEO_DOWNLOAD) private downloadQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRANSCRIPTION) private transcriptionQueue: Queue,
  ) {}

  // §20.1 pattern: validate -> fetch metadata -> upsert (idempotent) -> dispatch job -> log usage.
  async importVideo(dto: ImportVideoDto, organizationId: string, userId: string) {
    const youtubeId = extractYoutubeId(dto.youtubeUrl);
    if (!youtubeId) throw new BadRequestException('Could not parse a YouTube video ID from that URL');

    const channel = await this.prisma.client.channel.findFirst({
      where: { id: dto.channelId, organizationId },
    });
    if (!channel) throw new NotFoundException('Channel not found for this organization');

    const meta = await this.youtube.getVideoMeta(youtubeId);

    const video = await this.prisma.client.video.upsert({
      where: { youtubeVideoId_organizationId: { youtubeVideoId: youtubeId, organizationId } },
      create: {
        organizationId,
        channelId: dto.channelId,
        youtubeUrl: dto.youtubeUrl,
        youtubeVideoId: youtubeId,
        title: meta.title,
        durationSeconds: meta.durationSeconds,
        thumbnailUrl: meta.thumbnailUrl,
        status: VideoStatus.PENDING,
      },
      update: {
        status: VideoStatus.PENDING,
        errorMessage: null,
        updatedAt: new Date(),
      },
    });

    // jobId makes re-adding the same import a no-op — BullMQ deduplicates for us.
    await this.downloadQueue.add(
      'download',
      { videoId: video.id, youtubeUrl: dto.youtubeUrl, organizationId },
      { jobId: `download:${video.id}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    );

    await this.prisma.client.usageEvent.create({
      data: {
        organizationId,
        userId,
        eventType: EventType.VIDEO_IMPORTED,
        resourceId: video.id,
      },
    });

    return video;
  }

  async findAll(organizationId: string, status?: VideoStatus) {
    return this.prisma.client.video.findMany({
      where: { organizationId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, organizationId: string) {
    const video = await this.prisma.client.video.findFirst({
      where: { id, organizationId }, // tenant-scoped — NEVER findFirst({ where: { id } })
      include: { clips: { orderBy: { confidenceScore: 'desc' } } },
    });
    if (!video) throw new NotFoundException('Video not found');
    return video;
  }

  // Called by the Python clip-worker via PATCH /videos/:id/status (internal secret, no JWT).
  // The worker has no JWT/org context, so organizationId travels in the callback body instead.
  async applyStatusCallback(id: string, dto: VideoStatusCallbackDto) {
    if (!dto.organizationId) throw new BadRequestException('organizationId is required');

    const video = await transitionVideo(this.prisma, id, dto.organizationId, dto.status as never, {
      rawVideoS3Key: dto.rawVideoS3Key,
      audioS3Key: dto.audioS3Key,
      transcriptS3Key: dto.transcriptS3Key,
      errorMessage: dto.errorMessage,
      processingEnded: dto.status === 'READY' || dto.status === 'FAILED' ? new Date() : undefined,
    });

    // Chain the pipeline: DOWNLOADED -> kick off transcription.
    if (dto.status === 'DOWNLOADED') {
      await this.transcriptionQueue.add(
        'transcribe',
        { videoId: id, audioS3Key: dto.audioS3Key, organizationId: dto.organizationId },
        { jobId: `transcribe:${id}`, attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
      );
    }

    return video;
  }
}
