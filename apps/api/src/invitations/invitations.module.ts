import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [NotificationsModule, AuthModule],
  providers: [InvitationsService],
  controllers: [InvitationsController],
  exports: [InvitationsService], // consumed by OrganizationsController
})
export class InvitationsModule {}
