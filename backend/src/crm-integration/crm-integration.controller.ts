import {
  Controller, Get, Put, Post, Delete, Param, Query, Body,
  UseGuards, ForbiddenException, ParseUUIDPipe,
} from '@nestjs/common';
import { CrmIntegrationService } from './crm-integration.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Permission } from '../roles/enums/permission.enum';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { CrmProviderKey } from './entities/crm-connection.entity';

function assertCompanyAccess(user: User, companyId: string): void {
  if (user.role !== UserRole.SUPERADMIN && user.companyId !== companyId) {
    throw new ForbiddenException();
  }
}

/** Owner/superadmin: подключение CRM, проверка, маппинг менеджеров. */
@Controller('crm-integration')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CrmIntegrationController {
  constructor(private readonly crmService: CrmIntegrationService) {}

  // ===== Manager: статус/звонки — ДО :companyId-роутов, чтобы 'my' не парсился как UUID =====

  @Get('my/status')
  @RequirePermissions(Permission.CreateEntry)
  myStatus(@CurrentUser() user: User) {
    return this.crmService.myStatus(user);
  }

  @Get('my/calls')
  @RequirePermissions(Permission.CreateEntry)
  myCalls(@CurrentUser() user: User, @Query('from') from?: string, @Query('to') to?: string) {
    return this.crmService.myCalls(user, from, to);
  }

  @Post('my/calls/:callId/fetch')
  @RequirePermissions(Permission.CreateEntry)
  fetchCall(
    @CurrentUser() user: User,
    @Param('callId') callId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.crmService.fetchCall(user, callId, from, to);
  }

  // Подсказка «подключите CRM» команде клиента: показывать ли и почему это выгодно.
  // Право CreateEntry (менеджер и выше по нашей матрице) — читать её безопасно, секретов нет.
  @Get('my/hint')
  @RequirePermissions(Permission.ReadEntry)
  myHint(@CurrentUser() user: User) {
    return this.crmService.myCrmHint(user);
  }

  // Отложить подсказку на неделю. Решение руководителя отдела продаж, поэтому не требует
  // прав на изменение компании: оно ничего не настраивает и ничего не открывает.
  @Post('my/hint/snooze')
  @RequirePermissions(Permission.ReadEntry)
  snoozeHint(@CurrentUser() user: User) {
    return this.crmService.snoozeCrmHint(user);
  }

  // ===== Owner/superadmin =====

  @Get(':companyId')
  @RequirePermissions(Permission.UpdateCompany)
  getConnection(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.crmService.getConnection(companyId);
  }

  @Put(':companyId')
  @RequirePermissions(Permission.UpdateCompany)
  upsert(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: { provider: CrmProviderKey; webhookUrl?: string; baseUrl?: string; secret?: string },
    @CurrentUser() user: User,
  ) {
    assertCompanyAccess(user, companyId);
    return this.crmService.upsertConnection(companyId, dto, user.id);
  }

  @Delete(':companyId')
  @RequirePermissions(Permission.UpdateCompany)
  remove(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.crmService.deleteConnection(companyId);
  }

  @Post(':companyId/test')
  @RequirePermissions(Permission.UpdateCompany)
  test(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.crmService.testConnection(companyId);
  }

  @Get(':companyId/crm-users')
  @RequirePermissions(Permission.UpdateCompany)
  crmUsers(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.crmService.listCrmUsers(companyId);
  }

  @Post(':companyId/auto-map')
  @RequirePermissions(Permission.UpdateCompany)
  autoMap(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.crmService.autoMap(companyId);
  }

  @Put(':companyId/mapping')
  @RequirePermissions(Permission.UpdateCompany)
  updateMapping(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: { userMap: Record<string, string> },
    @CurrentUser() user: User,
  ) {
    assertCompanyAccess(user, companyId);
    return this.crmService.updateMapping(companyId, body.userMap ?? {});
  }

  // Владелец на онбординге импортирует выбранных сотрудников из CRM как команду (менеджеры/РОП).
  @Post(':companyId/import-team')
  @RequirePermissions(Permission.UpdateCompany)
  importTeam(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: { members: Array<{ fullName: string; email: string; role: string }> },
    @CurrentUser() user: User,
  ) {
    assertCompanyAccess(user, companyId);
    return this.crmService.importTeam(companyId, body.members ?? []);
  }

  // Ссылка-поручение администратору CRM клиента: он подключает портал сам, без входа в платформу.
  @Post(':companyId/setup-link')
  @RequirePermissions(Permission.UpdateCompany)
  setupLink(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() body: { sendToChat?: boolean },
    @CurrentUser() user: User,
  ) {
    assertCompanyAccess(user, companyId);
    return this.crmService.createSetupLink(companyId, Boolean(body?.sendToChat));
  }

  // Владелец не разобрался с подключением CRM → зовёт трекера (уведомление + флаг в карточке).
  @Post(':companyId/request-help')
  @RequirePermissions(Permission.UpdateCompany)
  requestHelp(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentUser() user: User) {
    assertCompanyAccess(user, companyId);
    return this.crmService.requestHelp(companyId);
  }
}
