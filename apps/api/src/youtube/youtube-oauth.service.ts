import { BadRequestException, ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { addSeconds } from 'date-fns';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/crypto/encryption.service';

// §14.1 scopes: upload (publish-worker, Day 14), readonly (channel info),
// yt-analytics.readonly (analytics sync, §17).
const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

type GoogleTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

type YoutubeChannelInfo = {
  youtubeChannelId: string;
  name: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
};

export type OAuthStateClaims = {
  sub: string; // userId
  orgId: string;
  purpose: 'youtube_oauth_state';
  csrf: string;
};

@Injectable()
export class YoutubeOAuthService {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  // The `state` param is a short-lived signed token rather than a raw userId —
  // only our server could have minted it, so it doubles as CSRF protection
  // across the Google redirect round-trip.
  buildAuthUrl(userId: string, orgId: string): string {
    const payload: OAuthStateClaims = {
      sub: userId,
      orgId,
      purpose: 'youtube_oauth_state',
      csrf: randomUUID(),
    };
    const state = this.jwt.sign(payload, { expiresIn: '10m' });

    const params = new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
      redirect_uri: process.env.YOUTUBE_REDIRECT_URI ?? '',
      scope: YOUTUBE_OAUTH_SCOPES,
      response_type: 'code',
      access_type: 'offline', // required for refresh token
      prompt: 'consent', // force re-consent so we always get a refresh token
      state,
    });

    return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
  }

  verifyState(state: string): OAuthStateClaims {
    let claims: OAuthStateClaims;
    try {
      claims = this.jwt.verify<OAuthStateClaims>(state);
    } catch {
      throw new UnauthorizedException('Invalid or expired OAuth state');
    }
    if (claims.purpose !== 'youtube_oauth_state') {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    return claims;
  }

  private async exchangeCode(code: string): Promise<GoogleTokenResponse> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
        client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
        redirect_uri: process.env.YOUTUBE_REDIRECT_URI ?? '',
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) {
      throw new BadRequestException('YouTube token exchange failed');
    }
    return res.json();
  }

  private async fetchMyChannel(accessToken: string): Promise<YoutubeChannelInfo> {
    const res = await fetch(
      'https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true',
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new BadRequestException('Failed to fetch YouTube channel info');

    const json = await res.json();
    const item = json.items?.[0];
    if (!item) throw new BadRequestException('No YouTube channel found on this Google account');

    return {
      youtubeChannelId: item.id,
      name: item.snippet?.title ?? 'Untitled channel',
      thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.default?.url ?? null,
      subscriberCount: item.statistics?.subscriberCount != null ? Number(item.statistics.subscriberCount) : null,
    };
  }

  // Full §14.1 callback: exchange code -> fetch channel -> encrypt tokens onto
  // the User -> upsert the Channel scoped to the org from the state token.
  async handleCallback(code: string, userId: string, organizationId: string) {
    const tokens = await this.exchangeCode(code);
    const channelInfo = await this.fetchMyChannel(tokens.access_token);

    const existing = await this.prisma.client.channel.findUnique({
      where: { youtubeChannelId: channelInfo.youtubeChannelId },
    });
    if (existing && existing.organizationId !== organizationId) {
      throw new ConflictException('This YouTube channel is already connected to another workspace');
    }

    await this.prisma.client.user.update({
      where: { id: userId },
      data: {
        ytAccessToken: this.encryption.encrypt(tokens.access_token),
        ytRefreshToken: tokens.refresh_token ? this.encryption.encrypt(tokens.refresh_token) : undefined,
        ytTokenExpiry: addSeconds(new Date(), tokens.expires_in),
      },
    });

    return this.prisma.client.channel.upsert({
      where: { youtubeChannelId: channelInfo.youtubeChannelId },
      create: {
        organizationId,
        userId,
        youtubeChannelId: channelInfo.youtubeChannelId,
        name: channelInfo.name,
        thumbnailUrl: channelInfo.thumbnailUrl,
        subscriberCount: channelInfo.subscriberCount,
        isActive: true,
      },
      update: {
        userId,
        name: channelInfo.name,
        thumbnailUrl: channelInfo.thumbnailUrl,
        subscriberCount: channelInfo.subscriberCount,
        isActive: true,
      },
    });
  }
}
