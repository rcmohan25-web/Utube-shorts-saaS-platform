import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';

import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './queues/queue.module';
import { AuthModule } from './auth/auth.module';
import { VideosModule } from './videos/videos.module';
import { ChannelsModule } from './channels/channels.module';
import { ClipsModule } from './clips/clips.module';
import { ShortsModule } from './shorts/shorts.module';
import { SchedulesModule } from './schedules/schedules.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BillingModule } from './billing/billing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrganizationsModule } from './organizations/organizations.module';
// PR 8 (§9.2/§11.6 Team Management): invite flow + public accept routes.
// Registered directly here (not just pulled in transitively via
// OrganizationsModule) so InvitationsController's public /invitations/:token/*
// routes are always mounted, matching the pattern NotificationsModule
// already uses for the same reason.
import { InvitationsModule } from './invitations/invitations.module';
// PR 9 (§9.4/§20.13 Security Hardening): AuditLogService is @Global(), so
// this import is what makes it available everywhere without every feature
// module having to import AuditLogModule individually — same shape as
// CryptoModule and StorageModule below.
import { AuditLogModule } from './audit/audit-log.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
    // PR 9 (§19.1 Security Hardening): three named buckets instead of one
    // flat limit.
    //   - 'default' (100/min): unauthenticated + regular user-facing routes,
    //     same limit as before this PR.
    //   - 'internal' (300/min): worker → API callbacks (video/clip/short
    //     status, schedule outcomes). Generous because legitimate traffic
    //     bursts when many parallel pipeline jobs finish at once, but it
    //     still caps a runaway retry storm or a brute-force attempt against
    //     API_INTERNAL_SECRET. Applied per-route via @Throttle({ internal: ... }).
    //   - 'webhook' (30/min): the Stripe webhook specifically. Legitimate
    //     volume is low and predictable; this is defense in depth on top of
    //     signature verification (§9.4), not the primary control.
    // Routes that don't opt into a named bucket via @Throttle(...) fall
    // back to 'default' automatically (NestJS throttler behavior).
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'internal', ttl: 60_000, limit: 300 },
      { name: 'webhook', ttl: 60_000, limit: 30 },
    ]),
    // CRITICAL: ScheduleModule.forRoot() must be here for @Cron decorators
    // to fire. Without this, YoutubeTokenService.refreshNearlyExpiredTokens(),
    // SchedulesService.checkStuckSchedules(), AnalyticsService.dailySyncAllPublished(),
    // and NotificationsService.weeklyDigest() silently never run — no
    // error, no warning, just nothing happening at the scheduled time.
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    StorageModule,
    AuditLogModule,
    QueueModule,
    AuthModule,
    VideosModule,
    ChannelsModule,
    ClipsModule,
    ShortsModule,
    SchedulesModule,
    AnalyticsModule,
    BillingModule,
    NotificationsModule,
    OrganizationsModule,
    InvitationsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
