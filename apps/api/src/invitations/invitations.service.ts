import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { addHours } from 'date-fns';
import { hash } from 'bcrypt';
import { InvitationStatus, UserRole } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';

// §15.1: "Team invite — Email only — Admin invites new user (48h expiry link)."
const INVITE_EXPIRY_HOURS = 48;

function hashToken(token: string) {
  // Same pattern as auth.service.ts's refresh-token hashing: the raw token
  // is high-entropy (randomUUID), so a fast SHA-256 hash is fine here —
  // bcrypt is reserved for low-entropy secrets like passwords.
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class InvitationsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private auth: AuthService,
  ) {}

  // §9.2: invite/remove team members is Admin+ — enforced at the controller
  // via @Roles(); this service assumes the caller already has permission
  // and focuses on the data invariants.
  async invite(dto: InviteUserDto, organizationId: string, invitedByUserId: string) {
    const existingUser = await this.prisma.client.user.findUnique({ where: { email: dto.email } });
    if (existingUser) {
      throw new ConflictException(
        existingUser.organizationId === organizationId
          ? 'This person is already a member of your workspace'
          : 'An account with this email already exists in another workspace',
      );
    }

    const existingInvite = await this.prisma.client.invitation.findFirst({
      where: { organizationId, email: dto.email, status: InvitationStatus.PENDING },
    });
    if (existingInvite) {
      throw new ConflictException('An invite is already pending for this email');
    }

    const org = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: organizationId } });

    // Raw token travels in the email link only — never stored, never logged.
    // Only its hash is persisted, mirroring the refresh-token pattern.
    const token = randomUUID();
    const invitation = await this.prisma.client.invitation.create({
      data: {
        organizationId,
        email: dto.email,
        role: dto.role as UserRole,
        tokenHash: hashToken(token),
        invitedByUserId,
        expiresAt: addHours(new Date(), INVITE_EXPIRY_HOURS),
      },
    });

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    await this.notifications.notifyTeamInvite(dto.email, org.name, `${frontendUrl}/invite/${token}`);

    return invitation;
  }

  async listPending(organizationId: string) {
    return this.prisma.client.invitation.findMany({
      where: { organizationId, status: InvitationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revoke(id: string, organizationId: string) {
    const invite = await this.prisma.client.invitation.findFirst({ where: { id, organizationId } });
    if (!invite) throw new NotFoundException('Invitation not found');
    if (invite.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(`Only pending invitations can be revoked (current status: ${invite.status})`);
    }
    return this.prisma.client.invitation.update({
      where: { id },
      data: { status: InvitationStatus.REVOKED },
    });
  }

  // Public — powers the /invite/[token] page's header before the person
  // fills in the accept form. Never returns the org's internal id.
  async preview(token: string) {
    const invite = await this.findValidByToken(token);
    const org = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: invite.organizationId } });
    return { email: invite.email, role: invite.role, organizationName: org.name };
  }

  // Public — creates the account, marks the invite ACCEPTED, and logs the
  // person straight in (same token shape as /auth/register).
  async accept(token: string, dto: AcceptInviteDto) {
    const invite = await this.findValidByToken(token);

    const existing = await this.prisma.client.user.findUnique({ where: { email: invite.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hash(dto.password, 10);

    const user = await this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: invite.organizationId,
          email: invite.email,
          passwordHash,
          name: dto.name,
          role: invite.role,
          emailVerified: true, // clicking an emailed link to a known address is the verification
        },
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { status: InvitationStatus.ACCEPTED, acceptedAt: new Date() },
      });
      return created;
    });

    const org = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: user.organizationId } });
    return this.auth.issueTokensForUser({
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      plan: org.plan,
    });
  }

  private async findValidByToken(token: string) {
    const invite = await this.prisma.client.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!invite) throw new NotFoundException('Invite not found');

    if (invite.status !== InvitationStatus.PENDING) {
      throw new BadRequestException(`This invite is no longer valid (${invite.status.toLowerCase()})`);
    }
    if (invite.expiresAt < new Date()) {
      // Lazily flip the status on first touch past expiry — no cron needed,
      // same "expire on read" spirit as nothing else in this codebase runs
      // a sweep for this.
      await this.prisma.client.invitation.update({
        where: { id: invite.id },
        data: { status: InvitationStatus.EXPIRED },
      });
      throw new BadRequestException('This invite has expired — ask an admin to send a new one');
    }
    return invite;
  }
}
