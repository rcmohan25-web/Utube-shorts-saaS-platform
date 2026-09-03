import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';

// @Global() so every feature module can inject AuditLogService without an
// explicit import — same pattern as StorageModule and CryptoModule. The
// controller is scoped normally (Nest doesn't globalize controllers).
@Global()
@Module({
  providers: [AuditLogService],
  controllers: [AuditLogController],
  exports: [AuditLogService],
})
export class AuditLogModule {}
