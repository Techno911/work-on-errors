import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from '../../roles/enums/permission.enum';
import { PERMISSIONS_KEY } from '../decorators/roles.decorator';
import { DEFAULT_ROLE_PERMISSIONS } from '../../roles/constants/default-permissions';
import { UserRole } from '../../users/enums/user-role.enum';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.role) {
      return false;
    }

    const userPermissions =
      DEFAULT_ROLE_PERMISSIONS[user.role as UserRole] || [];

    return requiredPermissions.every((permission) =>
      userPermissions.includes(permission),
    );
  }
}
