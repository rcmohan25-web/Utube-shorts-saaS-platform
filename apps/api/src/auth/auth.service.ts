import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcrypt';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { addDays } from 'date-fns';
import { UserRole, UserStatus } from '@shorts/db';
import type { AuthTokens, AuthenticatedUserClaims } from '@shorts/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || randomUUID().slice(0, 8)
  );
}

function hashToken(token: string) {
  // Refresh tokens are opaque UUIDs; we store only a SHA-256 hash (cheap, fine for
  // high-entropy random tokens — bcrypt is reserved for low-entropy passwords).
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async issueTokens(user: {
    id: string;
    organizationId: string;
    role: UserRole;
    plan: string;
  }): Promise<AuthTokens> {
    const claims: AuthenticatedUserClaims = {
      sub: user.id,
      orgId: user.organizationId,
      role: user.role as AuthenticatedUserClaims['role'],
      plan: user.plan as AuthenticatedUserClaims['plan'],
    };

    const accessToken = this.jwt.sign(claims, {
      expiresIn: process.env.JWT_EXPIRY ?? '15m',
    });

    const refreshToken = randomUUID();
    const expiryDays = Number(process.env.REFRESH_TOKEN_EXPIRY_DAYS ?? 30);
    await this.prisma.client.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: addDays(new Date(), expiryDays),
      },
    });

    return { accessToken, refreshToken };
  }

  // Public wrapper so other modules (InvitationsService, once an invite is
  // accepted) can log a freshly-created user in the exact same way
  // register()/login() do, without duplicating the claims/refresh-token
  // logic or exposing the private issueTokens() method itself.
  async issueTokensForUser(user: {
    id: string;
    organizationId: string;
    role: UserRole;
    plan: string;
  }): Promise<AuthTokens> {
    return this.issueTokens(user);
  }

  async register(dto: RegisterDto): Promise<AuthTokens> {
    const existing = await this.prisma.client.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    const passwordHash = await hash(dto.password, 10);
    const baseSlug = slugify(dto.organizationName);

    const { user, organization } = await this.prisma.client.$transaction(async (tx) => {
      // Ensure slug uniqueness without a retry loop in the common case.
      let slug = baseSlug;
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (await tx.organization.findUnique({ where: { slug } })) {
        attempt += 1;
        slug = `${baseSlug}-${attempt}`;
      }

      const organization = await tx.organization.create({
        data: { name: dto.organizationName, slug },
      });

      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          email: dto.email,
          passwordHash,
          name: dto.name,
          role: UserRole.OWNER, // first user in a new org is always OWNER
        },
      });

      return { user, organization };
    });

    return this.issueTokens({
      id: user.id,
      organizationId: organization.id,
      role: user.role,
      plan: organization.plan,
    });
  }

  async login(dto: LoginDto): Promise<AuthTokens> {
    const user = await this.prisma.client.user.findUnique({
      where: { email: dto.email },
      include: { organization: true },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // PR 8: deactivated members (§11.6 team management) can't log in.
    // NOTE: an access token issued before deactivation stays valid until it
    // naturally expires (15 min, §9.1) — this blocks new sessions, not
    // in-flight ones. Acceptable given the short TTL; a revocation list
    // would be needed to close that gap, which this PR doesn't add.
    if (user.status === UserStatus.DEACTIVATED) {
      throw new UnauthorizedException('This account has been deactivated. Contact your workspace admin.');
    }

    await this.prisma.client.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens({
      id: user.id,
      organizationId: user.organizationId,
      role: user.role,
      plan: user.organization.plan,
    });
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);
    const record = await this.prisma.client.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: { include: { organization: true } } },
    });

    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (record.user.status === UserStatus.DEACTIVATED) {
      throw new UnauthorizedException('This account has been deactivated. Contact your workspace admin.');
    }

    // Rotation: invalidate the old token the moment it's used once.
    await this.prisma.client.refreshToken.update({
      where: { id: record.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens({
      id: record.user.id,
      organizationId: record.user.organizationId,
      role: record.user.role,
      plan: record.user.organization.plan,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.client.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string, orgId: string) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: userId, organizationId: orgId }, // tenant-scoped even for self-lookup
      include: { organization: true },
    });
    if (!user) throw new UnauthorizedException();
    const safe = { ...user } as Partial<typeof user>;
    delete safe.passwordHash;
    delete safe.ytAccessToken;
    delete safe.ytRefreshToken;
    return safe;
  }
}
