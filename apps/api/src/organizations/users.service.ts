import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { UserRole, UserStatus } from '@shorts/db';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.client.user.findMany({
      where: { organizationId },
      select: {
        id: true, name: true, email: true, role: true, status: true,
        lastLoginAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async updateRole(targetUserId: string, newRole: UserRole, organizationId: string, requestingUserId: string) {
    const target = await this.prisma.client.user.findFirst({ where: { id: targetUserId, organizationId } });
    if (!target) throw new NotFoundException('User not found');

    if (target.role === UserRole.OWNER && newRole !== UserRole.OWNER) {
      await this.assertNotLastOwner(organizationId, targetUserId);
    }
    if (newRole === UserRole.OWNER && target.id !== requestingUserId) {
      // Ownership transfer is a distinct, higher-stakes action than a role
      // bump (it changes who can manage billing / delete the org, §9.2) —
      // deliberately out of scope for this endpoint rather than allowed
      // silently through a generic role dropdown.
      throw new ForbiddenException('Transferring ownership requires a dedicated flow — contact support');
    }

    return this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { role: newRole },
    });
  }

  async deactivate(targetUserId: string, organizationId: string, requestingUserId: string) {
    if (targetUserId === requestingUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const target = await this.prisma.client.user.findFirst({ where: { id: targetUserId, organizationId } });
    if (!target) throw new NotFoundException('User not found');

    if (target.role === UserRole.OWNER) {
      await this.assertNotLastOwner(organizationId, targetUserId);
    }

    return this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { status: UserStatus.DEACTIVATED },
    });
  }

  async reactivate(targetUserId: string, organizationId: string) {
    const target = await this.prisma.client.user.findFirst({ where: { id: targetUserId, organizationId } });
    if (!target) throw new NotFoundException('User not found');

    return this.prisma.client.user.update({
      where: { id: targetUserId },
      data: { status: UserStatus.ACTIVE },
    });
  }

  // Guards against a workspace ending up with zero active Owners — nobody
  // left who can manage billing or delete the org (§9.2 permission matrix).
  private async assertNotLastOwner(organizationId: string, excludingUserId: string) {
    const otherActiveOwners = await this.prisma.client.user.count({
      where: {
        organizationId,
        role: UserRole.OWNER,
        status: UserStatus.ACTIVE,
        id: { not: excludingUserId },
      },
    });
    if (otherActiveOwners === 0) {
      throw new BadRequestException(
        'Cannot remove the last owner of a workspace — promote another member to Owner first',
      );
    }
  }
}
