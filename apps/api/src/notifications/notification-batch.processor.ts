import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES } from '../queues/queue.constants';
import { NotificationsService } from './notifications.service';

type ShortsReadyBatchJob = { organizationId: string };

// Fires once the batching window (NotificationsService's BATCH_WINDOW_MS)
// elapses. Re-counts REVIEW shorts at fire time rather than trusting the
// count from when the job was queued — some may have been approved/rejected
// in the meantime, and a zero-count batch is a silent no-op, not an error.
@Processor(QUEUE_NAMES.NOTIFICATION)
export class NotificationBatchProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationBatchProcessor.name);

  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<ShortsReadyBatchJob>): Promise<void> {
    const { organizationId } = job.data;
    const count = await this.prisma.client.short.count({ where: { organizationId, status: 'REVIEW' } });
    if (count === 0) return;

    await this.notifications.send('SHORTS_READY', organizationId, { count });
    this.logger.log({ msg: 'notifications.shorts_ready_batch_sent', organizationId, count });
  }
}
