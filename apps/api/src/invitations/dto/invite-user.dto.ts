import { IsEmail, IsIn } from 'class-validator';
import { UserRole } from '@shorts/db';

// OWNER is intentionally excluded — an org has exactly one path to a new
// Owner (register a workspace), never an invite. Granting ownership is a
// separate, higher-stakes action handled by UsersService.updateRole().
export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsIn([UserRole.ADMIN, UserRole.EDITOR, UserRole.VIEWER])
  role!: 'ADMIN' | 'EDITOR' | 'VIEWER';
}
