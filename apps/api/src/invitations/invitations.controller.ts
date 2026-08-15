import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { InvitationsService } from './invitations.service';
import { AcceptInviteDto } from './dto/accept-invite.dto';

// Public-only controller: the two routes that a not-yet-a-user needs.
// Org-scoped invite management (invite/list/revoke) lives on
// OrganizationsController under /organizations/users/* — see §8.2's
// endpoint table — since those need an authenticated org context.
@Controller('invitations')
export class InvitationsController {
  constructor(private invitations: InvitationsService) {}

  @Public()
  @Get(':token/preview')
  preview(@Param('token') token: string) {
    return this.invitations.preview(token);
  }

  @Public()
  @Post(':token/accept')
  accept(@Param('token') token: string, @Body() dto: AcceptInviteDto) {
    return this.invitations.accept(token, dto);
  }
}
