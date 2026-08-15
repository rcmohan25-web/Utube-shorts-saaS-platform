import { IsString, MaxLength, MinLength } from 'class-validator';

// Body for POST /invitations/:token/accept. No email field — the email is
// fixed by the invite itself; the invitee can't redirect their own invite
// to a different address.
export class AcceptInviteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72) // bcrypt truncates beyond 72 bytes — same limit as RegisterDto
  password!: string;
}
