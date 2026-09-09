import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseInterceptors } from '@nestjs/common';
import { UserRole } from '@shorts/db';
import { Roles } from '../common/decorators/roles.decorator';
import { TenantInterceptor } from '../common/interceptors/tenant.interceptor';
import type { AuthenticatedRequest } from '../common/decorators/current-user.decorator';
import { OrganizationsService } from './organizations.service';
import { UsersService } from './users.service';
import { InvitationsService } from '../invitations/invitations.service';
import { UpdateOrganizationBrandingDto } from './dto/update-organization-branding.dto';
import { RequestLogoUploadDto } from './dto/request-logo-upload.dto';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { InviteUserDto } from '../invitations/dto/invite-user.dto';

@Controller('organizations')
@UseInterceptors(TenantInterceptor)
export class OrganizationsController {
  constructor(
    private organizations: OrganizationsService,
    private users: UsersService,
    private invitations: InvitationsService,
  ) {}

  @Put('branding')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  updateBranding(@Body() dto: UpdateOrganizationBrandingDto, @Req() req: AuthenticatedRequest) {
    // PR 9: actor id threaded through for the AuditLog entry.
    // PR 12: dto now also carries brandColor / logoS3Key.
    return this.organizations.updateBranding(req.organizationId, dto, req.user.sub);
  }

  // PR 12 (§15.2) — step 1 of the logo upload flow: mint a presigned PUT
  // URL. Admin+ only, same tier as "Manage branding" generally.
  @Post('branding/logo-upload-url')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  requestLogoUploadUrl(@Body() dto: RequestLogoUploadDto, @Req() req: AuthenticatedRequest) {
    return this.organizations.requestLogoUploadUrl(req.organizationId, dto.contentType);
  }

  // PR 12 — deliberately NOT @Roles()-gated: every authenticated member,
  // regardless of role, needs this to theme the app shell (logo, brand
  // color) and to know whether the "Powered by" footer should render.
  @Get('branding')
  getBranding(@Req() req: AuthenticatedRequest) {
    return this.organizations.getPublicBranding(req.organizationId);
  }

  // §11.6 /settings/users — team roster
  @Get('users')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  listUsers(@Req() req: AuthenticatedRequest) {
    return this.users.list(req.organizationId);
  }

  // §8.2 /organizations/users/invite (ADMIN+)
  @Post('users/invite')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  inviteUser(@Body() dto: InviteUserDto, @Req() req: AuthenticatedRequest) {
    return this.invitations.invite(dto, req.organizationId, req.user.sub);
  }

  @Get('users/invitations')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  listInvitations(@Req() req: AuthenticatedRequest) {
    return this.invitations.listPending(req.organizationId);
  }

  @Delete('users/invitations/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  revokeInvitation(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    // PR 9: actor id now threaded through for the AuditLog entry.
    return this.invitations.revoke(id, req.organizationId, req.user.sub);
  }

  // §8.2 /organizations/users/:id — "Change role (ADMIN+)"
  @Patch('users/:id')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  updateUserRole(@Param('id') id: string, @Body() dto: UpdateUserRoleDto, @Req() req: AuthenticatedRequest) {
    return this.users.updateRole(id, dto.role as UserRole, req.organizationId, req.user.sub);
  }

  @Patch('users/:id/deactivate')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  deactivateUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.users.deactivate(id, req.organizationId, req.user.sub);
  }

  @Patch('users/:id/reactivate')
  @Roles(UserRole.ADMIN, UserRole.OWNER)
  reactivateUser(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    // PR 9: actor id now threaded through for the AuditLog entry.
    return this.users.reactivate(id, req.organizationId, req.user.sub);
  }
}
