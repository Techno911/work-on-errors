import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  ForbiddenException,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { NORM_PRESET_LIST } from './norm-presets';

@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompaniesController {
  constructor(private readonly companiesService: CompaniesService) {}

  @Get()
  @RequirePermissions(Permission.CreateCompany)
  async findAll() {
    return this.companiesService.findAll();
  }

  /**
   * Состояние доступа своей компании. Единственная вещь, которую человек может прочитать
   * при приостановке за неоплату: из неё платформа рисует экран с объяснением.
   *
   * Пояснение собственнику (номер счёта, период) отдаём ТОЛЬКО собственнику: менеджеру и
   * РОПу знать сумму задолженности своей компании не нужно, им нужно понимать, что делать.
   * Объявлен ДО @Get(':id'), иначе параметрический роут перехватит путь и уронит его
   * на ParseUUIDPipe.
   */
  @Get('access-state')
  @RequirePermissions(Permission.ReadCompany)
  async getAccessState(@CurrentUser() currentUser: User) {
    if (!currentUser.companyId) return { paymentHold: false, since: null, note: null };
    const company = await this.companiesService.findById(currentUser.companyId);
    const isOwner = currentUser.role === UserRole.OWNER;
    return {
      companyName: company.name,
      paymentHold: company.paymentHold === true,
      since: company.paymentHoldInfo?.startedAt ?? null,
      note: isOwner ? company.paymentHoldInfo?.note ?? null : null,
    };
  }

  // Готовые режимы нормативов (справочник, не данные компании). Объявлен ДО @Get(':id'),
  // иначе параметрический роут перехватит «norm-presets» и уронит его на ParseUUIDPipe.
  @Get('norm-presets')
  @RequirePermissions(Permission.ReadCompany)
  listNormPresets() {
    return NORM_PRESET_LIST;
  }

  @Get(':id')
  @RequirePermissions(Permission.ReadCompany)
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: User,
  ) {
    if (currentUser.role !== UserRole.SUPERADMIN && currentUser.companyId !== id) {
      throw new ForbiddenException();
    }
    const company = await this.companiesService.findById(id);
    // Явная проекция, не вся entity: фронт объявляет ответ как {id,name} и больше ничего
    // не читает (frontend/src/api/companies.ts) — компания несла offerToken, crmSetupToken,
    // telegramBindCode, ropBonusProposal.token и legalInfo (ИНН/адрес заказчика), видимые
    // любой роли компании вплоть до менеджера. Секреты/реквизиты остаются на трекерском
    // GET /admin/companies/:id/details, который и должен их отдавать.
    return { id: company.id, name: company.name };
  }

  @Post()
  @RequirePermissions(Permission.CreateCompany)
  async create(@Body() dto: CreateCompanyDto) {
    return this.companiesService.create(dto);
  }

  @Patch(':id')
  @RequirePermissions(Permission.UpdateCompany)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() currentUser: User,
  ) {
    if (currentUser.role !== UserRole.SUPERADMIN && currentUser.companyId !== id) {
      throw new ForbiddenException();
    }
    return this.companiesService.update(id, dto, currentUser);
  }

  @Get(':id/members')
  @RequirePermissions(Permission.ReadUser)
  async getMembers(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() currentUser: User,
  ) {
    if (currentUser.role !== UserRole.SUPERADMIN && currentUser.companyId !== id) {
      throw new ForbiddenException();
    }
    return this.companiesService.getMembers(id);
  }

  @Get(':id/settings')
  @UseGuards(JwtAuthGuard)
  async getSettings(@Param('id') id: string, @CurrentUser() currentUser: User) {
    if (currentUser.role !== UserRole.SUPERADMIN && currentUser.companyId !== id) {
      throw new ForbiddenException();
    }
    return this.companiesService.getSettings(id);
  }

  // Эндпоинт для настроек геймификации — доступен owner/superadmin всегда,
  // reviewer — только если company.reviewerCanEditGamification === true
  @Patch(':id/gamification')
  @UseGuards(JwtAuthGuard)
  async updateGamification(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { gamificationEnabled?: boolean; reviewerCanEditGamification?: boolean },
    @CurrentUser() currentUser: User,
  ) {
    if (currentUser.role !== UserRole.SUPERADMIN && currentUser.companyId !== id) {
      throw new ForbiddenException();
    }
    const isOwnerOrAdmin = currentUser.role === UserRole.SUPERADMIN || currentUser.role === UserRole.OWNER;
    if (!isOwnerOrAdmin) {
      // Только РОП и только при явно включённом флаге. Менеджер (и любая другая роль) — запрет.
      if (currentUser.role !== UserRole.REVIEWER) throw new ForbiddenException();
      const settings = await this.companiesService.getSettings(id);
      if (!settings.reviewerCanEditGamification) throw new ForbiddenException();
      // Reviewer может менять только gamificationEnabled
      const updated = await this.companiesService.update(id, { gamificationEnabled: body.gamificationEnabled });
      return { gamificationEnabled: updated.gamificationEnabled };
    }
    const updated = await this.companiesService.update(id, {
      gamificationEnabled: body.gamificationEnabled,
      reviewerCanEditGamification: body.reviewerCanEditGamification,
    });
    // Не отдаём весь объект компании — только затронутые флаги
    return {
      gamificationEnabled: updated.gamificationEnabled,
      reviewerCanEditGamification: updated.reviewerCanEditGamification,
    };
  }
}
