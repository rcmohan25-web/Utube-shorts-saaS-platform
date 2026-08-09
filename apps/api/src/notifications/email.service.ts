import { Injectable, Logger } from '@nestjs/common';

// Adapter over Resend's HTTP API. No RESEND_API_KEY configured yet in dev —
// same "don't block the milestone, log instead" pattern as
// youtube.service.ts's getVideoMeta() without YOUTUBE_API_KEY. Swap
// providers by changing only this file.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(to: string, subject: string, body: string, actionUrl?: string | null): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? 'notifications@shorts.dev';
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    const html = `<p>${body}</p>${actionUrl ? `<p><a href="${frontendUrl}${actionUrl}">Open</a></p>` : ''}`;

    if (!apiKey) {
      this.logger.log({ msg: 'email.dev_log (RESEND_API_KEY not set)', to, subject, body });
      return;
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });

    if (!res.ok) {
      this.logger.error({ msg: 'email.send_failed', to, subject, status: res.status });
    }
  }
}
