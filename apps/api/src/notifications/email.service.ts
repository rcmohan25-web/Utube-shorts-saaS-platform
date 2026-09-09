import { Injectable, Logger } from '@nestjs/common';

// PR 12 (§15.2 white-label branding pass). Every outbound email now wraps
// its body in this org's branding — logo (or org name as text fallback),
// brand color for the CTA link, and a "Powered by Shorts Pilot" footer
// that's present by default and dropped once the sending org is on a
// white-label-eligible plan (showPoweredBy comes pre-computed from
// FLAGS.WHITE_LABEL by the caller, so this file stays plan-agnostic).
export type EmailBranding = {
  organizationName: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  showPoweredBy: boolean;
};

const DEFAULT_BRAND_COLOR = '#6d5bff';
const PLATFORM_NAME = 'Shorts Pilot';

// Adapter over Resend's HTTP API. No RESEND_API_KEY configured yet in dev —
// same "don't block the milestone, log instead" pattern as
// youtube.service.ts's getVideoMeta() without YOUTUBE_API_KEY. Swap
// providers by changing only this file.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async send(
    to: string,
    subject: string,
    body: string,
    actionUrl?: string | null,
    branding?: EmailBranding,
  ): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM ?? 'notifications@shorts.dev';
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';

    const html = this.renderHtml(body, actionUrl, frontendUrl, branding);

    if (!apiKey) {
      this.logger.log({
        msg: 'email.dev_log (RESEND_API_KEY not set)',
        to,
        subject,
        body,
        org: branding?.organizationName ?? PLATFORM_NAME,
      });
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

  // Kept as a small private helper (not a template file / engine) since
  // every email in this codebase shares the same one-paragraph-plus-CTA
  // shape (see notification-message.builder.ts) — a full templating layer
  // would be premature for what's still a single layout.
  private renderHtml(
    body: string,
    actionUrl: string | null | undefined,
    frontendUrl: string,
    branding?: EmailBranding,
  ): string {
    const orgName = branding?.organizationName ?? PLATFORM_NAME;
    const color = branding?.brandColor ?? DEFAULT_BRAND_COLOR;

    const headerHtml = branding?.logoUrl
      ? `<img src="${branding.logoUrl}" alt="${orgName}" style="height:32px;max-width:200px;object-fit:contain;margin-bottom:20px;" />`
      : `<div style="font-size:16px;font-weight:600;color:${color};margin-bottom:20px;">${orgName}</div>`;

    // Default true: absent branding (e.g. system emails with no org
    // context) shows the footer, same as every plan below Agency.
    const showPoweredBy = branding?.showPoweredBy ?? true;
    const footerHtml =
      showPoweredBy && orgName !== PLATFORM_NAME
        ? `<p style="margin-top:28px;font-size:12px;color:#9ca3af;">Powered by ${PLATFORM_NAME}</p>`
        : !showPoweredBy
          ? ''
          : ''; // orgName === PLATFORM_NAME means this *is* the platform's own email — no self-referential footer

    return `
      <div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111827;">
        ${headerHtml}
        <p style="font-size:14px;line-height:1.6;">${body}</p>
        ${
          actionUrl
            ? `<p style="margin-top:16px;"><a href="${frontendUrl}${actionUrl}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:${color};color:#ffffff;text-decoration:none;font-size:14px;">Open</a></p>`
            : ''
        }
        ${footerHtml}
      </div>
    `;
  }
}
