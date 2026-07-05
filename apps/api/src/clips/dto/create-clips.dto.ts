import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';

class ClipCandidateDto {
  @IsNumber()
  startSeconds!: number;

  @IsNumber()
  endSeconds!: number;

  @IsNumber()
  confidenceScore!: number;

  @IsOptional()
  @IsString()
  transcriptSegment?: string;

  @IsOptional()
  @IsString()
  aiReasoning?: string;

  @IsOptional()
  @IsString()
  suggestedTitle?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suggestedHashtags?: string[];
}

// Bulk callback from clip-worker after GPT-4o scoring (§6.2). No JWT context,
// so organizationId travels in the body — same pattern as VideoStatusCallbackDto.
export class CreateClipsDto {
  @IsString()
  organizationId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ClipCandidateDto)
  clips!: ClipCandidateDto[];
}
