import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FLAGS } from '@shorts/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { StorageService } from '../storage/storage.service';
import type { UpdateOrganizationBrandingDto } from './dto/update-organization-branding.dto';

// PR 12 (§15.2): maps the browser-native content type into the file
// extension used in the S3/R2 key, so logo-{uuid}.png / .jpg / .svg / .webp
// stay human-legible in the bucket browser rather than everything landing
// as a bare UUID with no extension.
const LOGO_CONTENT_TYPE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

@Injectable()
export class OrganizationsService {
  constructor(
    private prisma: PrismaService,
    private auditLog: AuditLogService,
    private storage: StorageService,
  ) {}

  // PR 12: now also carries brandColor + logoS3Key. Each field is only
  // touched if the caller actually sent it — omitting a field (e.g. only
  // updating brandColor) must never clobber an already-uploaded logo.
  async updateBranding(organizationId: string, dto: UpdateOrganizationBrandingDto, actorUserId: string) {
    const organization = await this.prisma.client.organization.findUnique({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const updated = await this.prisma.client.organization.update({
      where: { id: organizationId },
      data: {
        webhookUrl: dto.webhookUrl ?? organization.webhookUrl,
        brandColor: dto.brandColor ?? organization.brandColor,
        logoS3Key: dto.logoS3Key ?? organization.logoS3Key,
      },
    });

    await this.auditLog.record({
      organizationId,
      userId: actorUserId,
      action: 'organization.branding_updated',
      resourceType: 'organization',
      resourceId: organizationId,
      metadata: {
        webhookUrlChanged: dto.webhookUrl !== undefined,
        brandColorChanged: dto.brandColor !== undefined,
        logoChanged: dto.logoS3Key !== undefined,
      },
    });

    return updated;
  }

  // PR 12 (§15.2 branding flow, step 1 of 2): mints a presigned PUT URL
  // scoped to {orgId}/branding/logo-{uuid}.{ext} (§10.1 bucket layout).
  // The frontend PUTs the file directly to S3/R2 with this URL, then calls
  // updateBranding({ logoS3Key }) to confirm — same "presign, then
  // confirm" two-step already used for renders; raw bytes never transit
  // our own API process.
  async requestLogoUploadUrl(organizationId: string, contentType: string) {
    const ext = LOGO_CONTENT_TYPE_EXT[contentType] ?? 'png';
    const key = `${organizationId}/branding/logo-${randomUUID()}.${ext}`;
    const uploadUrl = await this.storage.getPresignedUploadUrl(key, contentType);
    return { uploadUrl, key };
  }

  // PR 12: the single read path every branding consumer uses — the app
  // shell (logo + color in the sidebar), NotificationsService (emails),
  // and eventually render-worker's branding overlay all resolve through
  // whichever of these three fields is actually set, rather than each
  // consumer re-deriving a presigned URL or re-checking the plan gate
  // independently. whiteLabelEnabled mirrors FLAGS.WHITE_LABEL (§20.7) —
  // Agency+ only, same gate as /agency and API keys.
  async getPublicBranding(organizationId: string) {
    const organization = await this.prisma.client.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const logoUrl = organization.logoS3Key
      ? await this.storage.getPresignedUrl(organization.logoS3Key, 3600)
      : null;

    return {
      organizationName: organization.name,
      logoUrl,
      brandColor: organization.brandColor,
      whiteLabelEnabled: FLAGS.WHITE_LABEL(organization.plan),
    };
  }
}
