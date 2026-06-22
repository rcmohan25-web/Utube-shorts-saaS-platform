import { IsIn, IsOptional, IsString } from 'class-validator';

// Body shape for the worker -> API callback (PATCH /videos/:id/status), §20.10 Day 5.
export class VideoStatusCallbackDto {
  @IsIn(['DOWNLOADING', 'DOWNLOADED', 'TRANSCRIBING', 'READY', 'FAILED'])
  status!: 'DOWNLOADING' | 'DOWNLOADED' | 'TRANSCRIBING' | 'READY' | 'FAILED';

  @IsOptional()
  @IsString()
  organizationId?: string; // worker includes this since it has no JWT/org context of its own

  @IsOptional()
  @IsString()
  rawVideoS3Key?: string;

  @IsOptional()
  @IsString()
  audioS3Key?: string;

  @IsOptional()
  @IsString()
  transcriptS3Key?: string;

  @IsOptional()
  @IsString()
  errorMessage?: string;
}
