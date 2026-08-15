import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { UsersService } from './users.service';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [PrismaModule, InvitationsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, UsersService],
})
export class OrganizationsModule {}
