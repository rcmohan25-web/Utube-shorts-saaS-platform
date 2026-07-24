import { IsDateString, IsString } from 'class-validator';

export class CreateScheduleDto {
  @IsString()
  shortId!: string;

  // channelId is taken from the Short itself (Short.channelId) to prevent
  // a user from publishing to a channel they don't own. This field is kept
  // for future use when a Short can be cross-posted to multiple channels.
  @IsString()
  channelId!: string;

  // ISO 8601 UTC string. Minimum 5 minutes in the future is enforced in
  // SchedulesService.create() — not here — so the error message can be
  // richer than what class-validator can express.
  @IsDateString()
  scheduledAt!: string;
}
