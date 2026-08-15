import { IsIn } from 'class-validator';
import { UserRole } from '@shorts/db';

export class UpdateUserRoleDto {
  @IsIn([UserRole.OWNER, UserRole.ADMIN, UserRole.EDITOR, UserRole.VIEWER])
  role!: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
}
