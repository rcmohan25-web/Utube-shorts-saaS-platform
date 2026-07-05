import { IsOptional, IsString } from 'class-validator';

export class RejectClipDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
