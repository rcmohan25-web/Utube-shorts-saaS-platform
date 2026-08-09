import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdateOrganizationBrandingDto {
  @IsOptional()
  @IsString()
  @IsUrl()
  webhookUrl?: string;
}
