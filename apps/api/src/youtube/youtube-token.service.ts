import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { addMinutes, addSeconds } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';

type RefreshResponse = {
  access_token: string;
  expires_in: number;
};

@Injectable()
export class YoutubeTokenService {
  private readonly logger = new Logger(YoutubeTokenService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  // ─── Critical path: called by PublishProcessor before every upload ───────
  //
  // Design choice: lazy refresh at use-time rather than trusting the cron.
  // Reason: if a publish job sits in BullMQ for >55 min (retry backoff, queue
  // backup), the pre-emptive cron has already fired and the new token may
  // itself have expired by the time the job runs. Lazy refresh at the moment
  // of dispatch is the only guarantee.
  //
  // Token freshness threshold = 5 minutes. This gives plenty of headroom for
  // the actual upload call (which can take up to 2 min for a 256 MB Short).
  async getValidAccessToken(userId: string): Promise<string> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId } });
    if (!user?.ytRefreshToken) {
      throw new Error(`User ${userId} has no YouTube refresh token — channel must be reconnected`);
    }

    const stillValid =
      user.ytAccessToken &&
      user.ytTokenExpiry &&
      user.ytTokenExpiry > addMinutes(new Date(), 5);

    if (stillValid) {
      return this.encryption.decrypt(user.ytAccessToken!);
    }

    this.logger.log(`Refreshing YouTube token for user ${userId}`);
    return this.refresh(userId, user.ytRefreshToken);
  }

  private async refresh(userId: string, encryptedRefreshToken: string): Promise<string> {
    const refreshToken = this.encryption.decrypt(encryptedRefreshToken);

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      // 400/401 here almost always means the user revoked access in Google.
      // Mark the channel disconnected so the dashboard surfaces the problem
      // rather than silently retrying publish jobs forever.
      await this.markChannelDisconnected(userId);
      throw new Error(
        `YouTube token refresh failed for user ${userId} (${res.status}) — ` +
          'channel disconnected; user must reconnect',
      );
    }

    const tokens: RefreshResponse = await res.json();

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ytAccessToken: this.encryption.encrypt(tokens.access_token),
        ytTokenExpiry: addSeconds(new Date(), tokens.expires_in),
      },
    });

    return tokens.access_token;
  }

  private async markChannelDisconnected(userId: string): Promise<void> {
    // Soft-disconnect all channels owned by this user — same semantics as
    // PATCH /channels/:id/disconnect, but triggered by a token failure
    // rather than a human action. User sees "Disconnected" badge in /settings
    // and can re-auth from there.
    await this.prisma.client.channel.updateMany({
      where: { userId },
      data: { isActive: false },
    });
    this.logger.warn(`Marked all channels for user ${userId} as disconnected (token revoked)`);
  }

  // ─── §14.2: Pre-emptive cron ─────────────────────────────────────────────
  //
  // Refreshes tokens for users who have PENDING publish jobs in the next 2
  // hours and whose access token expires in the next 10 minutes.
  //
  // This is a safety net — the lazy refresh above handles the actual critical
  // path. This just reduces the chance of cold-start latency (a refresh API
  // call adds ~200ms to the PublishProcessor's critical path).
  //
  // TODO: Before scaling API to >1 pod in K8s, replace this @Cron with a
  // Redis-based distributed lock (e.g. using Redlock) so only one pod runs
  // the refresh per tick. Right now, two pods would both refresh the same
  // tokens, which is wasteful but not incorrect (each refresh gets a valid
  // new token; last write wins on the User row).
  @Cron('*/55 * * * *')
  async refreshNearlyExpiredTokens(): Promise<void> {
    const twoHoursFromNow = addMinutes(new Date(), 120);
    const tenMinutesFromNow = addMinutes(new Date(), 10);

    // Find distinct userIds that own channels with pending publish jobs soon.
    const pendingSchedules = await this.prisma.client.schedule.findMany({
      where: {
        status: 'PENDING',
        scheduledAt: { lte: twoHoursFromNow },
      },
      include: { channel: true },
      distinct: ['channelId'],
    });

    const userIds = [...new Set(pendingSchedules.map((s) => s.channel.userId))];
    if (userIds.length === 0) return;

    // Among those users, find ones whose token is nearly expired.
    const needsRefresh = await this.prisma.client.user.findMany({
      where: {
        id: { in: userIds },
        ytRefreshToken: { not: null },
        ytTokenExpiry: { lte: tenMinutesFromNow },
      },
    });

    for (const user of needsRefresh) {
      try {
        await this.refresh(user.id, user.ytRefreshToken!);
        this.logger.log(`Pre-emptively refreshed token for user ${user.id}`);
      } catch (err) {
        // Already logged + channel disconnected inside refresh(). Don't throw
        // — one bad token shouldn't abort the loop for all other users.
        this.logger.error(`Pre-emptive refresh failed for user ${user.id}`, err);
      }
    }
  }
}
