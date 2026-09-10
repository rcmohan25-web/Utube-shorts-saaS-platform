import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { UsersService } from './users.service';
import { InvitationsModule } from '../invitations/invitations.module';

// PR 12 note: OrganizationsService now depends on StorageService (for the
// presigned logo-upload URL). StorageModule is @Global() (see
// apps/api/src/storage/storage.module.ts), so no explicit import is
// needed here for Nest's DI to resolve it.
@Module({
  imports: [PrismaModule, InvitationsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, UsersService],
})
export class OrganizationsModule {}
