import { IsOptional, IsString, IsUrl, Matches, MaxLength } from 'class-validator';

// PR 12 (§15.2 white-label branding pass): extends the original
// webhookUrl-only DTO with brandColor + logoS3Key. logoS3Key is never
// accepted as an arbitrary client-supplied string in the sense of "point
// at any object" — OrganizationsController's upload flow always mints it
// server-side (requestLogoUploadUrl) scoped under {orgId}/branding/, so a
// caller can only ever "confirm" a key they were just handed, not redirect
// branding at an unrelated S3 object.
export class UpdateOrganizationBrandingDto {
  @IsOptional()
  @IsString()
  @IsUrl()
  webhookUrl?: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'brandColor must be a hex color, e.g. #6d5bff' })
  brandColor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  logoS3Key?: string;
}
