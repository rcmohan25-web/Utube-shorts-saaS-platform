import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { QuotaService } from './quota.service';
// PR 7 (§15 Notifications): BillingService.onPaymentFailed() and
// QuotaService.checkAndNotifyThreshold() both call NotificationsService —
// this import was missing before PR 7, which meant the module would not
// compile against BillingService's constructor. One-way import: neither
// NotificationsModule nor its dependencies import BillingModule back.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [BillingService, QuotaService],
  controllers: [BillingController],
  // QuotaService is exported so SchedulesModule can inject it directly
  // into SchedulesService.create() — see that module's comment.
  exports: [BillingService, QuotaService],
})
export class BillingModule {}
