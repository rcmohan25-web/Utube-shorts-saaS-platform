import { IsString, MinLength } from 'class-validator';

// Manual channel registration. Real OAuth-based connect flow (§14.1) comes in Sprint 9.
export class CreateChannelDto {
  @IsString()
  @MinLength(1)
  youtubeChannelId!: string;

  @IsString()
  @MinLength(1)
  name!: string;
}
