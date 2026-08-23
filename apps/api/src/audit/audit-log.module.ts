import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

// @Global() so every feature module can inject AuditLogService without an
// explicit import — same pattern as StorageModule and CryptoModule.
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
