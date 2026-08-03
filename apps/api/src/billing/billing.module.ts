import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { QuotaService } from './quota.service';

@Module({
  providers: [BillingService, QuotaService],
  controllers: [BillingController],
  // QuotaService is exported so SchedulesModule can inject it directly
  // into SchedulesService.create() — see that module's comment.
  exports: [BillingService, QuotaService],
})
export class BillingModule {}
