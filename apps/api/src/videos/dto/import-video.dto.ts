import { IsString, IsUrl } from 'class-validator';

export class ImportVideoDto {
  @IsUrl({}, { message: 'youtubeUrl must be a valid URL' })
  youtubeUrl!: string;

  @IsString()
  channelId!: string;
}
