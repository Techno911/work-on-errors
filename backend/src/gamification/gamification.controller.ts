import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  UseGuards,
  ForbiddenException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { GamificationService } from './gamification.service';
import { CompaniesService } from '../companies/companies.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import type { XpSettingsData, AchievementSettingsData } from './types/gamification-settings.types';

@Controller('gamification')
@UseGuards(JwtAuthGuard)
export class GamificationController {
  constructor(
    private readonly svc: GamificationService,
    private readonly companiesService: CompaniesService,
  ) {}

  @Get('profile')
  getMyProfile(@CurrentUser() user: User) {
    return this.svc.getProfile(user.id);
  }

  @Get('profile/:userId')
  async getProfile(@Param('userId') userId: string, @CurrentUser() user: User) {
    // Чужой профиль: только свой, superadmin или коллега по компании
    if (userId !== user.id && user.role !== 'superadmin') {
      const target = await this.svc.getUserCompanyId(userId);
      if (!target || target !== user.companyId) throw new ForbiddenException();
    }
    return this.svc.getProfile(userId);
  }

  @Get('leaderboard/:companyId')
  getLeaderboard(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== 'superadmin' && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return this.svc.getLeaderboard(companyId);
  }

  @Get('config/:companyId')
  getConfig(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== 'superadmin' && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    return this.svc.getGamificationConfig(companyId);
  }

  @Patch('config/:companyId')
  async updateConfig(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: { xpSettings?: Partial<XpSettingsData>; achievementSettings?: Partial<AchievementSettingsData> },
    @CurrentUser() user: User,
  ) {
    if (user.role !== 'superadmin' && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    // Менять настройки геймификации могут owner/superadmin; РОП — только при флаге.
    // Менеджер (и любая другая роль) — запрет.
    if (user.role !== 'superadmin' && user.role !== 'owner') {
      if (user.role !== 'reviewer') throw new ForbiddenException();
      const settings = await this.companiesService.getSettings(companyId);
      if (!settings.reviewerCanEditGamification) throw new ForbiddenException();
    }
    // Санитизация: тело — plain-объект без class-validator, поэтому отрицательные/абсурдные XP
    // (напр. entrySubmitted:-999) иначе загоняют лидерборд и профили в минус. Клампим в [0, 10000].
    const clamp = (obj?: Record<string, unknown>) =>
      obj ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.max(0, Math.min(10000, Math.round(Number(v) || 0)))])) : obj;
    const safeBody = { xpSettings: clamp(body.xpSettings), achievementSettings: clamp(body.achievementSettings) };
    return this.svc.updateGamificationConfig(companyId, safeBody);
  }
}
