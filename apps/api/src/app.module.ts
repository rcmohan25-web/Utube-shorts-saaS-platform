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
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    // CRITICAL: ScheduleModule.forRoot() must be here for @Cron decorators
    // to fire. Without this, YoutubeTokenService.refreshNearlyExpiredTokens(),
    // SchedulesService.checkStuckSchedules(), AnalyticsService.dailySyncAllPublished(),
    // and NotificationsService.weeklyDigest() silently never run — no
    // error, no warning, just nothing happening at the scheduled time.
    ScheduleModule.forRoot(),
    PrismaModule,
    CryptoModule,
    StorageModule,
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
