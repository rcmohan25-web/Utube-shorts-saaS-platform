import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

// Callback from render-worker (§6.1 stages 7-14) — always a CREATE: the
// Short row doesn't exist until the render attempt finishes, success or
// fail. `shortId` is the id ClipsService.approve() pre-generated.
export class CreateShortDto {
  @IsString()
  shortId!: string;

  @IsString()
  clipId!: string;

  @IsString()
  channelId!: string;

  @IsString()
  organizationId!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsIn(['REVIEW', 'FAILED'])
  status!: 'REVIEW' | 'FAILED';

  @IsOptional()
  @IsString()
  renderS3Key?: string;

  @IsOptional()
  @IsString()
  thumbnailS3Key?: string;

  @IsOptional()
  @IsString()
  captionS3Key?: string;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
