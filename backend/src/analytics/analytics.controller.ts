import { Controller, Get, Query, UseGuards, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

function assertCompanyAccess(user: User, requestedCompanyId: string): void {
  if (user.role !== UserRole.SUPERADMIN && user.companyId !== requestedCompanyId) {
    throw new ForbiddenException();
  }
}

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
  ) {}

  @Get('error-frequency')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ViewAnalytics)
  getErrorFrequency(
    @Query('companyId') companyId: string,
    @Query('period') period: string = 'all',
    @CurrentUser() user: User,
  ) {
    assertCompanyAccess(user, companyId);
    return this.analyticsService.getErrorFrequency(companyId, period);
  }

  @Get('error-trend')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ViewAnalytics)
  getErrorTrend(
    @Query('companyId') companyId: string,
    @Query('tagId') tagId: string,
    @CurrentUser() user: User,
  ) {
    assertCompanyAccess(user, companyId);
    return this.analyticsService.getErrorTrend(companyId, tagId);
  }

  @Get('manager-stats')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ViewAnalytics)
  getManagerStats(
    @Query('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('sprintId') sprintId?: string,
  ) {
    assertCompanyAccess(user, companyId);
    return this.analyticsService.getManagerStats(companyId, sprintId);
  }

  @Get('activity-patterns')
  @UseGuards(JwtAuthGuard)
  getActivityPatterns(
    @Query('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('managerId') managerId?: string,
  ) {
    assertCompanyAccess(user, companyId);
    // Manager видит только свои паттерны (принудительно), остальные роли — по query param
    const resolvedManagerId = user.role === UserRole.MANAGER ? user.id : managerId;
    return this.analyticsService.getActivityPatterns(companyId, resolvedManagerId);
  }

  /**
   * GET /analytics/reviewer-stats?companyId=...&reviewerId=... — KPI конкретного РОПа за период.
   * Reviewer видит только свои показатели. Owner / superadmin — любого РОПа компании.
   */
  @Get('reviewer-stats')
  @UseGuards(JwtAuthGuard)
  getReviewerStats(
    @Query('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('reviewerId') reviewerId?: string,
  ) {
    assertCompanyAccess(user, companyId);
    const resolvedReviewerId = user.role === UserRole.REVIEWER ? user.id : reviewerId;
    if (!resolvedReviewerId) {
      throw new ForbiddenException('reviewerId required');
    }
    return this.analyticsService.getReviewerStats(companyId, resolvedReviewerId);
  }

  @Get('export')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(Permission.ViewAnalytics)
  exportData(
    @Query('companyId') companyId: string,
    @CurrentUser() user: User,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    assertCompanyAccess(user, companyId);
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if (fromDate && isNaN(fromDate.getTime())) throw new BadRequestException('Некорректная дата начала периода');
    if (toDate && isNaN(toDate.getTime())) throw new BadRequestException('Некорректная дата конца периода');
    if (fromDate && toDate && fromDate > toDate) throw new BadRequestException('Начало периода не может быть позже конца');
    return this.analyticsService.exportData(companyId, fromDate, toDate);
  }
}
