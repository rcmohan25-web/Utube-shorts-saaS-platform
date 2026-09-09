import { IsIn } from 'class-validator';

// PR 12 (§15.2). Kept as an explicit allowlist rather than a generic
// @IsMimeType() — every one of these has to be renderable both in the web
// app (an <img>) and burned into an FFmpeg overlay filter by render-worker
// (§20.10 Day 7's branding overlay), so we don't want to accept, say,
// image/avif today and discover render-worker can't composite it later.
const ALLOWED_LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const;

export class RequestLogoUploadDto {
  @IsIn(ALLOWED_LOGO_CONTENT_TYPES)
  contentType!: (typeof ALLOWED_LOGO_CONTENT_TYPES)[number];
}
