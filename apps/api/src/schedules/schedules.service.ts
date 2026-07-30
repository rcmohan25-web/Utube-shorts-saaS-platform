import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { addDays, addMinutes, endOfDay, startOfDay } from 'date-fns';
import { EventType, ShortStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { VideoGateway } from '../websockets/video.gateway';
import { QUEUE_NAMES } from '../queues/queue.module';
import { CreateScheduleDto } from './dto/create-schedule.dto';
// PR 5 (§17 Analytics Engine): schedule the first analytics-sync job the
// moment a Short actually goes live, per §17.1 "24h after publish:
// analytics-sync job queued for first day."
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private videoGateway: VideoGateway,
    private analytics: AnalyticsService,
    @InjectQueue(QUEUE_NAMES.PUBLISH) private publishQueue: Queue,
  ) {}

  async create(dto: CreateScheduleDto, organizationId: string, userId: string) {
    // ── 1. Validate the Short ───────────────────────────────────────────────
    const short = await this.prisma.client.short.findFirst({
      where: { id: dto.shortId, organizationId },
      include: { channel: { include: { user: true } } },
    });
    if (!short) throw new NotFoundException('Short not found');

    // ── 2. Guarantee G1: no duplicate active schedule ───────────────────────
    const existingSchedule = await this.prisma.client.schedule.findFirst({
      where: {
        organizationId,
        shortId: dto.shortId,
        status: { in: ['PENDING', 'PUBLISHED'] },
      },
    });
    if (existingSchedule) {
      throw new ConflictException(
        existingSchedule.status === 'PUBLISHED'
          ? 'This Short has already been published to YouTube'
          : 'This Short already has a pending schedule — cancel it first if you want to reschedule',
      );
    }

    if (short.youtubeVideoId || short.status === ShortStatus.PUBLISHED) {
      throw new ConflictException('This Short has already been published to YouTube');
    }

    if (short.status !== ShortStatus.APPROVED) {
      throw new BadRequestException(
        `Short must be APPROVED before scheduling — current status: ${short.status}. ` +
          'Approve it from the review queue first.',
      );
    }
    if (!short.renderS3Key) {
      throw new BadRequestException('Short has no render file — cannot schedule');
    }

    // ── 3. Validate the channel ─────────────────────────────────────────────
    const channel = await this.prisma.client.channel.findFirst({
      where: { id: dto.channelId, organizationId, isActive: true },
      include: { user: true },
    });
    if (!channel) throw new NotFoundException('Channel not found or disconnected');

    if (!channel.user.ytRefreshToken) {
      throw new BadRequestException(
        'The channel owner must reconnect their YouTube account before scheduling. ' +
          'Go to Settings → Channels to reconnect.',
      );
    }

    // ── 3. §14.4: YouTube daily upload limit — 100 videos per channel per day
    const scheduledDate = new Date(dto.scheduledAt);
    const dailyCount = await this.prisma.client.schedule.count({
      where: {
        channelId: dto.channelId,
        scheduledAt: { gte: startOfDay(scheduledDate), lte: endOfDay(scheduledDate) },
        status: { in: ['PENDING', 'PUBLISHED'] },
      },
    });
    if (dailyCount >= 100) {
      throw new BadRequestException(
        `YouTube's daily upload limit (100 videos) is already reached for this channel on ${
          scheduledDate.toISOString().split('T')[0]
        }. Choose a different date.`,
      );
    }

    // ── 5. Time window validation ───────────────────────────────────────────
    const minScheduledAt = addMinutes(new Date(), 5);
    if (scheduledDate < minScheduledAt) {
      throw new BadRequestException(
        'scheduledAt must be at least 5 minutes in the future to give the publish pipeline time to prepare',
      );
    }

    // YouTube's publishAt parameter only works up to ~100 days in the future.
    const maxScheduledAt = addDays(new Date(), 100);
    if (scheduledDate > maxScheduledAt) {
      throw new BadRequestException(
        'scheduledAt cannot be more than 100 days in the future (YouTube limit)',
      );
    }

    // ── 6. Create the Schedule row, then dispatch BullMQ ───────────────────
    // Intentionally NOT in a $transaction: we want the Schedule row committed
    // before we dispatch to BullMQ, so if BullMQ dispatch fails we can
    // compensate cleanly (delete the orphaned row and let the error surface
    // to the caller). Doing both in a transaction would mean the Schedule
    // row is invisible to the stuck-schedule cron during the transaction
    // window — a minor issue but inconsistent with how we handle other workers.
    const schedule = await this.prisma.client.schedule.create({
      data: {
        organizationId,
        shortId: dto.shortId,
        channelId: dto.channelId,
        scheduledAt: scheduledDate,
        status: 'PENDING',
      },
    });

    let job;
    try {
      const delay = Math.max(0, scheduledDate.getTime() - Date.now());
      job = await this.publishQueue.add(
        'publish',
        { scheduleId: schedule.id, organizationId },
        {
          jobId: `publish_${schedule.id}`,
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 60_000 }, // 1→2→4→8→16 min
        },
      );
    } catch (err) {
      // Guarantee G4: compensate — delete the orphaned Schedule row so the
      // user doesn't see a PENDING schedule with no underlying BullMQ job.
      await this.prisma.client.schedule.delete({ where: { id: schedule.id } });
      throw new Error(`Failed to dispatch publish job: ${(err as Error).message}`);
    }

    const updated = await this.prisma.client.schedule.update({
      where: { id: schedule.id },
      data: { bullJobId: job.id },
    });

    this.logger.log({
      msg: 'schedule.created',
      scheduleId: schedule.id,
      shortId: dto.shortId,
      channelId: dto.channelId,
      organizationId,
      scheduledAt: scheduledDate.toISOString(),
      delayMs: Math.max(0, scheduledDate.getTime() - Date.now()),
      createdBy: userId,
    });

    return updated;
  }

  async findAll(
    organizationId: string,
    from?: string,
    to?: string,
    channelId?: string,
  ) {
    const schedules = await this.prisma.client.schedule.findMany({
      where: {
        organizationId,
        ...(channelId ? { channelId } : {}),
        ...(from && to
          ? { scheduledAt: { gte: new Date(from), lte: new Date(to) } }
          : {}),
      },
      orderBy: { scheduledAt: 'asc' },
      include: {
        short: true,
        channel: true,
      },
    });

    // Resolve presigned thumbnail URLs for the calendar display.
    // §9.4: never return a raw S3 key — only presigned URLs.
    return Promise.all(
      schedules.map(async (s) => ({
        ...s,
        short: {
          ...s.short,
          thumbnailPresignedUrl: s.short.thumbnailS3Key
            ? await this.storage.getPresignedUrl(s.short.thumbnailS3Key)
            : null,
        },
      })),
    );
  }

  async cancel(scheduleId: string, organizationId: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id: scheduleId, organizationId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    if (schedule.status !== 'PENDING') {
      throw new BadRequestException(
        `Only PENDING schedules can be cancelled (current status: ${schedule.status})`,
      );
    }

    // Remove from BullMQ. The job might be in ACTIVE state (currently being
    // processed) — in that case remove() throws. We swallow that exception
    // because the active PublishProcessor will check schedule.status on the
    // DB and bail out when it sees CANCELLED.
    if (schedule.bullJobId) {
      try {
        await this.publishQueue.remove(schedule.bullJobId);
      } catch (err) {
        this.logger.warn({
          msg: 'schedule.cancel.bullmq_remove_failed',
          scheduleId,
          bullJobId: schedule.bullJobId,
          reason: (err as Error).message,
        });
      }
    }

    const updated = await this.prisma.client.schedule.update({
      where: { id: scheduleId },
      data: { status: 'CANCELLED' },
    });

    this.logger.log({ msg: 'schedule.cancelled', scheduleId, organizationId });
    return updated;
  }

  // ── Callback from publish-worker: upload succeeded ──────────────────────
  // Guarantee G2 is enforced here: the Short.youtubeVideoId check in
  // PublishProcessor catches double-uploads before they happen. This method
  // is idempotent if called twice with the same youtubeVideoId (status check).
  async markPublished(scheduleId: string, organizationId: string, youtubeVideoId: string) {
    const result = await this.prisma.client.$transaction(async (tx) => {
      const schedule = await tx.schedule.findFirst({
        where: { id: scheduleId, organizationId },
        include: { short: true },
      });
      if (!schedule) throw new NotFoundException('Schedule not found');

      // Terminal states are immutable: a late callback must not flip a
      // published or cancelled schedule back into a different state.
      if (schedule.status === 'PUBLISHED' || schedule.status === 'FAILED' || schedule.status === 'CANCELLED') {
        return {
          schedule,
          shortId: schedule.shortId,
          alreadyPublished: schedule.status === 'PUBLISHED',
        };
      }

      const updatedSchedule = await tx.schedule.update({
        where: { id: scheduleId },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          youtubeVideoId,
          updatedAt: new Date(),
        },
      });

      // Cascade: Short → PUBLISHED. Uses direct update (not transitionShort)
      // because we're inside a $transaction and transitionShort uses the
      // module-level PrismaService which creates a new transaction context.
      const currentShort = await tx.short.findFirst({
        where: { id: schedule.shortId, organizationId },
      });
      if (!currentShort) throw new NotFoundException('Short not found during publish cascade');
      if (currentShort.status !== ShortStatus.APPROVED && currentShort.status !== ShortStatus.SCHEDULED) {
        this.logger.warn({
          msg: 'schedule.markPublished.unexpected_short_status',
          shortId: schedule.shortId,
          shortStatus: currentShort.status,
          scheduleId,
        });
      }

      await tx.short.update({
        where: { id: schedule.shortId },
        data: {
          status: ShortStatus.PUBLISHED,
          youtubeVideoId,
          updatedAt: new Date(),
        },
      });

      await tx.usageEvent.create({
        data: {
          organizationId,
          eventType: EventType.SHORT_PUBLISHED,
          resourceId: schedule.shortId,
          metadata: { scheduleId, youtubeVideoId },
        },
      });

      return { schedule: updatedSchedule, shortId: schedule.shortId, alreadyPublished: false };
    });

    if (!result.alreadyPublished) {
      this.videoGateway.emitShortPublished(organizationId, {
        shortId: result.shortId,
        youtubeVideoId,
        publishedAt: new Date().toISOString(),
      });

      // PR 5 (§17.1): kick off the first analytics sync 24h from now.
      // Fire-and-forget is intentional here in the sense that a queue-add
      // failure shouldn't fail the publish confirmation itself — but we do
      // still want it logged loudly if it ever happens, since a missed
      // scheduleFirstSync() means that Short never gets picked up until the
      // next 3am daily cron (§17.1) finds it via the PUBLISHED-status scan.
      try {
        await this.analytics.scheduleFirstSync(result.shortId, organizationId);
      } catch (err) {
        this.logger.error({
          msg: 'schedule.markPublished.analytics_schedule_failed',
          shortId: result.shortId,
          organizationId,
          reason: (err as Error).message,
        });
      }
    }

    this.logger.log({
      msg: 'schedule.published',
      scheduleId,
      shortId: result.shortId,
      youtubeVideoId,
      organizationId,
    });

    return result.schedule;
  }

  // ── Callback from publish-worker: upload failed ─────────────────────────
  async markFailed(scheduleId: string, organizationId: string, errorMessage: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id: scheduleId, organizationId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    if (schedule.status === 'PUBLISHED' || schedule.status === 'FAILED' || schedule.status === 'CANCELLED') {
      this.logger.warn({
        msg: 'schedule.markFailed.ignored_terminal_state',
        scheduleId,
        organizationId,
        currentStatus: schedule.status,
      });
      return schedule;
    }

    const updated = await this.prisma.client.schedule.update({
      where: { id: scheduleId },
      data: {
        status: 'FAILED',
        lastError: errorMessage,
        retryCount: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    this.logger.error({
      msg: 'schedule.failed',
      scheduleId,
      organizationId,
      errorMessage,
      retryCount: updated.retryCount,
    });

    return updated;
  }

  // ── Callback from publish-worker: YouTube quota exceeded ────────────────
  // Guarantee G3: postpones ALL pending schedules for this channel by 24h.
  async postponeForQuota(scheduleId: string, organizationId: string) {
    const schedule = await this.prisma.client.schedule.findFirst({
      where: { id: scheduleId, organizationId },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    const pendingForChannel = await this.prisma.client.schedule.findMany({
      where: { channelId: schedule.channelId, organizationId, status: 'PENDING' },
    });

    let postponedCount = 0;
    for (const s of pendingForChannel) {
      const newScheduledAt = addDays(new Date(s.scheduledAt), 1);

      await this.prisma.client.schedule.update({
        where: { id: s.id },
        data: { scheduledAt: newScheduledAt, updatedAt: new Date() },
      });

      // Update the BullMQ job's delay. Strategy: remove + re-add with same
      // jobId. This works for DELAYED jobs. For ACTIVE jobs, remove() throws
      // and we skip the re-add — the active job completes normally (it will
      // re-hit the quota and call back again, where we'll postpone again).
      if (s.bullJobId) {
        try {
          await this.publishQueue.remove(s.bullJobId);
          const newDelay = Math.max(0, newScheduledAt.getTime() - Date.now());
          await this.publishQueue.add(
            'publish',
            { scheduleId: s.id, organizationId },
            {
              jobId: `publish_${s.id}`,
              delay: newDelay,
              attempts: 5,
              backoff: { type: 'exponential', delay: 60_000 },
            },
          );
        } catch (err) {
          this.logger.warn({
            msg: 'schedule.quota_postpone.bullmq_failed',
            scheduleId: s.id,
            bullJobId: s.bullJobId,
            reason: (err as Error).message,
          });
        }
      }
      postponedCount++;
    }

    // §8.3 quota:warning event
    this.videoGateway.emitQuotaWarning(organizationId, {
      channelId: schedule.channelId,
      postponedCount,
      postponedBy: '24h',
    });

    this.logger.warn({
      msg: 'schedule.quota_exceeded',
      scheduleId,
      channelId: schedule.channelId,
      organizationId,
      postponedCount,
    });

    return { postponedCount };
  }

  // ── §7.3: Stuck-schedule detection cron ────────────────────────────────
  // Runs every 10 minutes. Catches schedules where publish-worker accepted
  // the job (BullMQ job is COMPLETE) but never called back to mark the
  // Schedule as PUBLISHED or FAILED — publish-worker crash, network partition, etc.
  @Cron('*/10 * * * *')
  async checkStuckSchedules(): Promise<void> {
    const staleThreshold = addMinutes(new Date(), -30); // 30 min past scheduledAt
    const stuck = await this.prisma.client.schedule.findMany({
      where: {
        status: 'PENDING',
        scheduledAt: { lt: staleThreshold },
      },
    });

    if (stuck.length === 0) return;

    this.logger.warn({ msg: 'schedule.stuck_check', count: stuck.length });

    for (const s of stuck) {
      await this.markFailed(
        s.id,
        s.organizationId,
        'Schedule missed — publish-worker did not report back within 30 minutes of scheduledAt. ' +
          'Check publish-worker logs. The Short is still APPROVED and can be rescheduled.',
      );
    }
  }
}
