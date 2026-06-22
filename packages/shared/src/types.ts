// Shared between apps/api and apps/web so the contract can't silently drift.

export type ApiError = {
  error: { code: string; message: string; upgradeUrl?: string };
};

export type ApiSuccess<T> = {
  data: T;
  meta?: { page?: number; limit?: number; total?: number; cursor?: string | null };
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthenticatedUserClaims = {
  sub: string; // userId
  orgId: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  plan: 'STARTER' | 'CREATOR' | 'AGENCY' | 'ENTERPRISE';
};

// WebSocket event payloads (§8.3) — kept here so frontend + backend agree on shape.
export type VideoStatusEvent = { videoId: string; status: string; progress?: number };
export type ClipCreatedEvent = { videoId: string; clipId: string; score: number };
export type ShortReadyEvent = { shortId: string; thumbnailUrl: string };
export type ShortPublishedEvent = { shortId: string; youtubeVideoId: string; publishedAt: string };
