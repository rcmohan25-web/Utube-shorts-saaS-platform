import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, IsUrl } from 'class-validator';

// §15.2 "Bulk import: CSV of YouTube URLs → mass queue import." CSV
// parsing happens client-side (the browser already has FileReader) — this
// endpoint just takes the resulting array of URLs, so it works equally
// well from the UI, a script, or the public API.
export class BulkImportVideosDto {
  @IsString()
  channelId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200) // generous single-batch cap; larger sets should be chunked client-side
  @IsUrl({}, { each: true })
  youtubeUrls!: string[];
}
