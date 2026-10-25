import { Controller, Get, Post, Query, UseGuards, ForbiddenException, HttpCode, HttpStatus } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('manager')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  getManagerData(
    @Query('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('managerId') managerId: string,
  ) {
    if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    // Менеджер видит только свой дашборд — нельзя подставить managerId коллеги (приватность разбора)
    const effectiveManagerId = user.role === UserRole.MANAGER ? user.id : managerId;
    return this.dashboardService.getManagerData(companyId, effectiveManagerId);
  }

  // Экран состояния собственника: идёт работа или нет, кто её не делает, что от него требуется.
  @Get('owner-state')
  getOwnerState(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== UserRole.SUPERADMIN && user.role !== UserRole.TRACKER && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return this.dashboardService.getOwnerState(companyId);
  }

  // Владелец высылает доступы заново тем, кто не вошёл: его команда, его действие.
  @Post('owner-state/resend-access')
  @HttpCode(HttpStatus.OK)
  resendAccess(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== UserRole.SUPERADMIN && user.role !== UserRole.TRACKER && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    if (user.role === UserRole.MANAGER || user.role === UserRole.REVIEWER) {
      throw new ForbiddenException('Доступы команде высылает владелец компании');
    }
    return this.dashboardService.resendAccess(companyId, user.id);
  }

  // Владелец зовёт трекера с экрана состояния.
  @Post('owner-state/call-tracker')
  @HttpCode(HttpStatus.OK)
  callTracker(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return this.dashboardService.callTracker(companyId, user);
  }

  @Get('reviewer')
  @UseGuards(PermissionsGuard)
  @RequirePermissions(Permission.ReadSprint)
  getReviewerData(@Query('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return this.dashboardService.getReviewerData(companyId, user.id);
  }
}
