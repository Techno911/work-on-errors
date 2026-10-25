import {
  Controller,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RopBonusService } from './rop-bonus.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

@Controller('rop-bonus')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RopBonusController {
  constructor(private readonly svc: RopBonusService) {}

  @Get(':companyId/history')
  @RequirePermissions(Permission.ViewAnalytics)
  getHistory(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('months', new DefaultValuePipe(6), ParseIntPipe) months: number,
    @CurrentUser() user: User,
  ) {
    this.assertCompanyAccess(user, companyId);
    return this.svc.getHistory(companyId, months);
  }

  @Get(':companyId')
  @RequirePermissions(Permission.ViewAnalytics)
  getMonth(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('period') period: string | undefined,
    @CurrentUser() user: User,
  ) {
    this.assertCompanyAccess(user, companyId);
    return this.svc.getMonthStats(companyId, period);
  }

  private assertCompanyAccess(user: User, companyId: string) {
    if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
  }
}
