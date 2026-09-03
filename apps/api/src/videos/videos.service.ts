import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventType, VideoStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queues/queue.module';
import { YoutubeService, extractYoutubeId } from '../youtube/youtube.service';
import { VideoGateway } from '../websockets/video.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { ImportVideoDto } from './dto/import-video.dto';
import { VideoStatusCallbackDto } from './dto/video-status-callback.dto';
import { BulkImportVideosDto } from './dto/bulk-import.dto';
import { transitionVideo } from './video-status.machine';

// Coarse progress mapping for the WebSocket payload (§8.3) — not meant to be
// frame-accurate, just enough for a progress bar that visibly moves between
// pipeline stages without each worker having to report granular percentages.
const STAGE_PROGRESS: Record<string, number> = {
  PENDING: 0,
  DOWNLOADING: 20,
  DOWNLOADED: 40,
  TRANSCRIBING: 60,
  READY: 100,
  FAILED: 100,
};

@Injectable()
export class VideosService {
  constructor(
    private prisma: PrismaService,
    private youtube: YoutubeService,
    private videoGateway: VideoGateway,
    private notifications: NotificationsService,
    @InjectQueue(QUEUE_NAMES.VIDEO_DOWNLOAD) private downloadQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TRANSCRIPTION) private transcriptionQueue: Queue,
    @InjectQueue(QUEUE_NAMES.CLIP_DETECTION) private clipDetectionQueue: Queue,
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

    const existingVideo = await this.prisma.client.video.findUnique({
      where: { youtubeVideoId_organizationId: { youtubeVideoId: youtubeId, organizationId } },
    });

    if (existingVideo && existingVideo.status !== VideoStatus.FAILED) {
      return existingVideo;
    }

    const video = existingVideo
      ? await this.prisma.client.video.update({
          where: { id: existingVideo.id },
          data: { errorMessage: null, updatedAt: new Date(), status: VideoStatus.PENDING },
        })
      : await this.prisma.client.video.create({
          data: {
            organizationId,
            channelId: dto.channelId,
            youtubeUrl: dto.youtubeUrl,
            youtubeVideoId: youtubeId,
            title: meta.title,
            durationSeconds: meta.durationSeconds,
            thumbnailUrl: meta.thumbnailUrl,
            status: VideoStatus.PENDING,
          },
        });

    // jobId makes re-adding the same import a no-op — BullMQ deduplicates for us.
    await this.downloadQueue.add(
      'download',
      { videoId: video.id, youtubeUrl: dto.youtubeUrl, organizationId },
      { jobId: `download_${video.id}`, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    );

    await this.prisma.client.usageEvent.create({
      data: { organizationId, userId, eventType: EventType.VIDEO_IMPORTED, resourceId: video.id },
    });

    this.videoGateway.emitVideoStatus(organizationId, {
      videoId: video.id,
      status: video.status,
      progress: STAGE_PROGRESS[video.status],
    });

    return video;
  }

  // PR 10 (§15.2) — bulk CSV import. Same idempotent upsert-per-URL path
  // as importVideo(), just looped. Feature-gated (BULK_IMPORT, excludes
  // Starter) at the controller. One bad URL never aborts the batch — each
  // row succeeds or fails independently, mirroring the "one Short's
  // failure never blocks siblings" pattern in analytics-sync.processor.ts.
  async bulkImport(dto: BulkImportVideosDto, organizationId: string, userId: string) {
    const results: Array<{ youtubeUrl: string; status: 'imported' | 'error'; videoId?: string; error?: string }> = [];

    for (const youtubeUrl of dto.youtubeUrls) {
      try {
        const video = await this.importVideo({ youtubeUrl, channelId: dto.channelId }, organizationId, userId);
        results.push({ youtubeUrl, status: 'imported', videoId: video.id });
      } catch (err) {
        results.push({ youtubeUrl, status: 'error', error: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    return {
      total: dto.youtubeUrls.length,
      imported: results.filter((r) => r.status === 'imported').length,
      failed: results.filter((r) => r.status === 'error').length,
      results,
    };
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

  // Called by Python workers via PATCH /videos/:id/status (internal secret, no JWT).
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

    // §8.3 — every pipeline stage change pushed live, org-scoped.
    this.videoGateway.emitVideoStatus(dto.organizationId, {
      videoId: id,
      status: video.status,
      progress: STAGE_PROGRESS[video.status],
    });

    if (dto.status === 'FAILED') {
      await this.notifications.notify('PIPELINE_FAILURE', dto.organizationId, {
        resourceType: 'video',
        resourceId: id,
        reason: dto.errorMessage ?? 'Video pipeline failed — check worker logs.',
      });
    }

    // Chain the pipeline: DOWNLOADED -> kick off transcription.
    if (dto.status === 'DOWNLOADED') {
      await this.transcriptionQueue.add(
        'transcribe',
        { videoId: id, audioS3Key: dto.audioS3Key, organizationId: dto.organizationId },
        { jobId: `transcribe_${id}`, attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
      );
    }

    // Chain the pipeline: READY (transcript done) -> kick off clip detection.
    if (dto.status === 'READY') {
      await this.clipDetectionQueue.add(
        'detect-clips',
        {
          videoId: id,
          organizationId: dto.organizationId,
          rawVideoS3Key: video.rawVideoS3Key,
          audioS3Key: video.audioS3Key,
          transcriptS3Key: video.transcriptS3Key,
          videoTitle: video.title,
        },
        { jobId: `detect-clips_${id}`, attempts: 2, backoff: { type: 'exponential', delay: 30_000 } },
      );
    }

    return video;
  }
}
