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
import { InvitationsModule } from './invitations/invitations.module';
import { AuditLogModule } from './audit/audit-log.module';
// PR 10 (§15.2 Agency White-Label)
import { AgencyModule } from './agency/agency.module';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { PublicApiModule } from './public-api/public-api.module';
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
    // PR 10 adds 'external' — a fourth named bucket for the public API
    // (§15.2), distinct from 'internal' (our own trusted workers). Per-IP
    // like the other buckets; per-API-key throttling is a follow-up.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
      { name: 'internal', ttl: 60_000, limit: 300 },
      { name: 'webhook', ttl: 60_000, limit: 30 },
      { name: 'external', ttl: 60_000, limit: 120 },
    ]),
    // CRITICAL: ScheduleModule.forRoot() must be here for @Cron decorators
    // to fire (see comments elsewhere in this file's history for details).
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
    AgencyModule,
    ApiKeysModule,
    PublicApiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
