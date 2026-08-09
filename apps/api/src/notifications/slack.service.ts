import { Injectable, Logger } from '@nestjs/common';

// Posts to Organization.webhookUrl (§15.2 also reuses this field for
// white-label integrations). Never throws — a Slack outage must not break
// the underlying notification pipeline.
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  async post(webhookUrl: string, text: string): Promise<void> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) this.logger.warn({ msg: 'slack.post_failed', status: res.status });
    } catch (err) {
      this.logger.warn({ msg: 'slack.post_error', reason: (err as Error).message });
    }
  }
}
