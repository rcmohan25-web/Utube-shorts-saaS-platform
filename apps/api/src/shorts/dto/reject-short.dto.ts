import { IsOptional, IsString } from 'class-validator';

export class RejectShortDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
