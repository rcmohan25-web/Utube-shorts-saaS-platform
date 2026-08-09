import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { UserRole } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { VideoGateway } from '../websockets/video.gateway';
import { QUEUE_NAMES } from '../queues/queue.constants';
import { EmailService } from './email.service';
import { SlackService } from './slack.service';
import { NOTIFICATION_CHANNELS, type NotificationType } from './notification.types';
import { buildNotificationMessage } from './notification-message.builder';

type NotificationJobData = {
  type: NotificationType;
  organizationId: string;
  payload: Record<string, unknown>;
};

@Processor(QUEUE_NAMES.NOTIFICATION)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private email: EmailService,
    private slack: SlackService,
    private videoGateway: VideoGateway,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { type, organizationId, payload } = job.data;
    const channels = NOTIFICATION_CHANNELS[type];
    const { title, body, actionUrl } = buildNotificationMessage(type, payload);

    if (channels.inApp) {
      const notification = await this.prisma.client.notification.create({
        data: {
          organizationId,
          type,
          title,
          body,
          actionUrl,
          metadata: payload as never,
        },
      });
      this.videoGateway.emitNotification(organizationId, {
        id: notification.id,
        type,
        title,
        body,
        actionUrl,
        createdAt: notification.createdAt.toISOString(),
      });
    }

    if (channels.email) {
      // §15.1: billing and pipeline-health notifications go to the people
      // who can act on them — Owner + Admin — not every Viewer's inbox.
      const recipients = await this.prisma.client.user.findMany({
        where: { organizationId, role: { in: [UserRole.OWNER, UserRole.ADMIN] } },
        select: { email: true },
      });
      for (const r of recipients) {
        await this.email.send(r.email, title, body);
      }
    }

    if (channels.slack) {
      const org = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
      if (org?.webhookUrl) {
        await this.slack.post(org.webhookUrl, `*${title}*\n${body}`);
      } else {
        this.logger.log({ msg: 'notification.slack_skipped_no_webhook', organizationId, type });
      }
    }

    this.logger.log({ msg: 'notification.sent', type, organizationId, channels });
  }
}
