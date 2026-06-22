import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@shorts/db';

export const ROLES_KEY = 'roles';

// @Roles(UserRole.EDITOR, UserRole.ADMIN, UserRole.OWNER)
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
