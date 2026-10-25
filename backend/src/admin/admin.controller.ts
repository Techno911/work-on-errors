import {
  Controller, Get, Post, Patch, Delete, Param, Body, Res, UseGuards, UseInterceptors,
  UploadedFile, ParseUUIDPipe, NotFoundException, BadRequestException, ForbiddenException,
} from '@nestjs/common';
import { PrepareProposalDto } from './dto/prepare-proposal.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import * as fs from 'fs';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AdminService } from './admin.service';
import { AuthService } from '../auth/auth.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Permission } from '../roles/enums/permission.enum';
import { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { Company, CompanyStatus, LicenseMode } from '../companies/entities/company.entity';
import { WeeklyReportScheduler } from '../analytics/weekly-report.scheduler';
import { RopBonusPayoutScheduler } from '../analytics/rop-bonus-payout.scheduler';
import { LoopGuardScheduler } from '../analytics/loop-guard.scheduler';
import { StaffNotifierService } from '../analytics/staff-notifier.service';
import { RopBonusOfferService } from '../rop-bonus-offer/rop-bonus-offer.service';
import { type NormPresetName } from '../companies/norm-presets';

@Controller('admin')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(Permission.CreateCompany) // Only superadmin has this
export class AdminController {
  constructor(
    private readonly authService: AuthService,
    private readonly adminService: AdminService,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly weeklyReport: WeeklyReportScheduler,
    private readonly payoutReport: RopBonusPayoutScheduler,
    private readonly loopGuard: LoopGuardScheduler,
    private readonly ropBonusOffer: RopBonusOfferService,
    private readonly staffNotifier: StaffNotifierService,
  ) {}

  // Применение готового режима нормативов трекером. Сам справочник режимов отдаёт
  // GET /companies/norm-presets: он нужен и владельцу, которому admin-роуты закрыты.
  @Post('companies/:id/norm-preset')
  applyNormPreset(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { preset: NormPresetName },
    @CurrentUser() actor: User,
  ) {
    return this.adminService.applyNormPreset(id, dto?.preset, actor);
  }

  // Трекер готовит предложение премии РОПа собственнику и генерирует ссылку-лендинг.
  @Post('companies/:id/rop-bonus-proposal')
  prepareRopBonusProposal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrepareProposalDto,
  ) {
    return this.ropBonusOffer.prepareProposal(id, dto.draft, dto.source ?? 'profile');
  }

  // Трекер применяет вариант собственника после согласования (переносит в боевую настройку).
  @Post('companies/:id/rop-bonus-proposal/apply')
  applyRopBonusOwnerVariant(@Param('id', ParseUUIDPipe) id: string) {
    return this.ropBonusOffer.applyOwnerVariant(id);
  }

  // Item 5: трекер согласовал премию с собственником в переписке и вносит итог напрямую —
  // премия подключается сразу, суперадмину падает уведомление «согласовано с трекером».
  @Post('companies/:id/rop-bonus-agreed')
  applyRopBonusAgreed(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { baseAmount: number; minThresholdPct: number; payoutDay: number | null; workdaysOnly: boolean },
  ) {
    return this.ropBonusOffer.applyAgreed(id, dto);
  }

  // Тестовая отправка отчёта в каналы компании прямо сейчас (superadmin).
  // type: 'weekly' — еженедельный отчёт, 'bonus' — премия РОПа,
  // 'digest' — личный дайджест РОПу, 'debt' — эскалация фидбэк-долга владельцу,
  // 'health' — свод здоровья петель суперадмину.
  @Post('companies/:id/test-report')
  async sendTestReport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { type?: 'weekly' | 'bonus' | 'digest' | 'debt' | 'health' },
  ) {
    const company = await this.companyRepo.findOne({ where: { id } });
    if (!company) throw new NotFoundException();
    const type = body?.type ?? 'weekly';
    // Раньше отвечали {sent:true} безусловно, даже когда каналы пустые — суперадмин думал,
    // что рассылка работает (SCHED1). Теперь sent=false + reason, если реально некуда/нечего слать.
    let sent: boolean;
    let reason: string | undefined;
    if (type === 'bonus') {
      sent = await this.payoutReport.sendPayoutReport(company);
      if (!sent) reason = 'нет настроенных каналов отчётности';
    } else if (type === 'digest') {
      const count = await this.loopGuard.sendRopDigest(company, true);
      sent = count > 0;
      if (!sent) reason = 'нет РОПа с привязанным Telegram или очередь пуста';
    } else if (type === 'debt') {
      sent = await this.loopGuard.checkCompanyDebt(company, 80, true, true);
      if (!sent) reason = 'нет активного спринта, сданных записей или каналов владельца';
    } else if (type === 'health') {
      sent = await this.loopGuard.sendSuperadminHealth(true);
      if (!sent) reason = 'нет ни одного чата нашей стороны: задайте SUPERADMIN_TG_CHAT_ID или подключите Telegram суперадмину';
    } else {
      sent = await this.weeklyReport.processCompany(company);
      if (!sent) reason = 'нет настроенных каналов отчётности';
    }
    return { sent, type, ...(reason ? { reason } : {}) };
  }

  /**
   * Состояние сторожей: когда каждый отработал и что у него сейчас открыто.
   *
   * Это замена ежедневному «всё чисто» в Telegram (03.09.2026). Живость механизма стала
   * ЭКРАНОМ, куда человек смотрит когда хочет, а мессенджер остался для новостей.
   */
  @Get('watchdogs')
  getWatchdogs() {
    return this.staffNotifier.state();
  }

  @Get('companies')
  getCompanies() {
    return this.adminService.getCompaniesWithMetrics();
  }

  @Get('companies/:id/details')
  getCompanyDetails(@Param('id') id: string) {
    return this.adminService.getCompanyDetails(id);
  }

  @Post('companies')
  createCompany(@Body() dto: CreateCompanyDto) {
    return this.adminService.createCompany(dto);
  }

  // Ссылка-оферта для существующей компании (в т.ч. легаси без токена) — трекер отправляет её владельцу.
  @Post('companies/:id/offer-link')
  ensureOfferLink(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.ensureOfferLink(id);
  }

  // Код привязки рабочего ТГ-чата: трекер постит «/bind <code>» в чате, бот фиксирует старт работы.
  @Post('companies/:id/telegram-bind-code')
  ensureBindCode(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.ensureBindCode(id);
  }

  // Запуск работы после онбординга: kick-off сообщение команде в рабочий чат + отметка launchedAt.
  @Post('companies/:id/launch')
  launchCompany(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { message?: string }) {
    return this.adminService.launchCompany(id, dto?.message ?? '');
  }

  // Ручная дата старта работы (пересчитывает бесплатный период от неё).
  @Post('companies/:id/work-start')
  setWorkStart(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { date: string }) {
    return this.adminService.setWorkStart(id, dto.date);
  }

  // Реквизиты юрлица/ИП заказчика (заказчик оферты — юрлицо, а не бренд).
  @Patch('companies/:id/legal-info')
  saveLegalInfo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { legalName?: string; inn?: string; kpp?: string; ogrn?: string; address?: string; signatory?: string },
  ) {
    return this.adminService.saveLegalInfo(id, dto);
  }

  // Жизненный статус компании (бейдж трекера): launch/active/closed/demo.
  // Паузы здесь нет намеренно: она оформляется отдельным действием с причиной и датой возврата.
  @Patch('companies/:id/status')
  setCompanyStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { status: CompanyStatus },
    @CurrentUser() actor: User,
  ) {
    return this.adminService.setCompanyStatus(id, dto.status, actor);
  }

  // Пауза с условиями: причина, планируемая дата возврата, ответственный, условие окончания.
  @Post('companies/:id/pause')
  pauseCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { reason: string; expectedReturnAt: string; responsible?: string; conditionToEnd?: string },
    @CurrentUser() actor: User,
  ) {
    return this.adminService.pauseCompany(id, dto, actor);
  }

  // Приостановка работы за неоплату и её снятие. Только суперадмин: это решение о расчётах
  // с клиентом, а не производственное действие, и трекеру оно не принадлежит. Класс контроллера
  // гейтится правом CreateCompany, которое есть и у трекера, поэтому роль проверяем здесь.
  @Post('companies/:id/payment-hold')
  holdForPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { note?: string },
    @CurrentUser() actor: User,
  ) {
    if (actor.role !== UserRole.SUPERADMIN) {
      throw new ForbiddenException('Приостановку за неоплату включает только владелец ЧиП');
    }
    return this.adminService.holdForPayment(id, dto?.note, actor);
  }

  @Delete('companies/:id/payment-hold')
  releasePaymentHold(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    if (actor.role !== UserRole.SUPERADMIN) {
      throw new ForbiddenException('Приостановку за неоплату снимает только владелец ЧиП');
    }
    return this.adminService.releasePaymentHold(id, actor);
  }

  // «Подключать нечем»: у клиента нет CRM или телефония не отдаёт записи. Ставит трекер или
  // владелец ЧиП, и платформа перестаёт предлагать команде подключение. Пока отметки нет,
  // подсказка приходит: неподключённая CRM без объяснения это просто забытый шаг.
  @Post('companies/:id/crm-not-applicable')
  setCrmNotApplicable(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { notApplicable: boolean; reason?: string },
    @CurrentUser() actor: User,
  ) {
    return this.adminService.setCrmNotApplicable(id, Boolean(dto?.notApplicable), dto?.reason, actor);
  }

  // Снять паузу вручную (обычно её снимает перезапуск работы).
  @Post('companies/:id/resume')
  resumeCompany(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    return this.adminService.resumeCompany(id, actor);
  }

  // Перезапуск работы после простоя: новое сообщение команде, новая точка отсчёта, сторож заново.
  @Post('companies/:id/relaunch')
  relaunchCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { message?: string },
    @CurrentUser() actor: User,
  ) {
    return this.adminService.relaunchCompany(id, dto?.message ?? '', actor);
  }

  // Журнал событий компании: что происходило и доходили ли сигналы.
  @Get('companies/:id/events')
  getCompanyEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getCompanyEvents(id);
  }

  // Режим лицензии: trial (бесплатный тест) или implementation (уже внедрение, лицензия бесплатна).
  @Patch('companies/:id/license-mode')
  setLicenseMode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { mode: LicenseMode },
    @CurrentUser() actor: User,
  ) {
    return this.adminService.setLicenseMode(id, dto.mode, actor);
  }

  // Загрузка договора (Word) к компании. Файл содержит реквизиты — отдаётся только авторизованно.
  @Post('companies/:id/contract')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const dir = join(process.cwd(), 'uploads', 'contracts');
          fs.mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `${unique}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const ext = extname(file.originalname).toLowerCase();
        if (['.doc', '.docx', '.pdf', '.rtf'].includes(ext)) return cb(null, true);
        // SEC-4: обычный Error здесь превращался в 500 (не HttpException — глобальный фильтр
        // не знает статус), хотя это самая обычная ошибка валидации входа клиента.
        cb(new BadRequestException('Договор загружается в формате Word (.doc/.docx), PDF или RTF'), false);
      },
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 МБ — договору с запасом хватает
    }),
  )
  uploadContract(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Файл не получен');
    return this.adminService.attachContract(id, file);
  }

  // Скачать загруженный договор (superadmin). Файл с ПД — не публичная статика.
  @Get('companies/:id/contract')
  async downloadContract(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { absPath, fileName } = await this.adminService.resolveContractFile(id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.download(absPath, fileName);
  }

  // Обнаруженные боты-чаты (куда добавили нашего бота), ещё не привязанные.
  @Get('telegram/detected-chats')
  listDetectedChats() {
    return this.adminService.listDetectedChats();
  }

  // Дёрнуть опрос Telegram сейчас (кнопка «Проверить»).
  @Post('telegram/poll')
  async pollTelegram() {
    await this.adminService.pollTelegramNow();
    return { ok: true };
  }

  // Привязать обнаруженный чат к компании (без команды в чате клиента).
  @Post('companies/:id/bind-chat')
  bindChat(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { chatId: string }) {
    return this.adminService.bindDetectedChat(id, dto.chatId);
  }

  @Get('companies/:id/users')
  getCompanyUsers(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getCompanyUsers(id);
  }

  @Post('companies/:id/users')
  createCompanyUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { fullName: string; email: string; role: string },
  ) {
    return this.adminService.createCompanyUser(id, dto);
  }

  // «Посмотреть глазами»: access-токен сотрудника на 15 минут, без refresh —
  // сессия суперадмина в браузере не затрагивается. Опасно (вход под чужим) → только суперадмин.
  @Post('users/:id/impersonate')
  @RequirePermissions(Permission.Impersonate)
  impersonate(@Param('id', ParseUUIDPipe) id: string) {
    return this.authService.impersonate(id);
  }

  // Сброс пароля даёт полный, не ограниченный по времени доступ под чужим именем — не слабее
  // impersonate, а сильнее (impersonate живёт 15 минут и не имеет refresh). Раньше метод не имел
  // собственного @RequirePermissions и наследовал класс-гейт CreateCompany, который есть и у
  // трекера — трекер мог обойти запрет impersonate именно через сброс пароля (SEC-3).
  // Персональная досылка доступа сотруднику в рабочий чат (только тем, кто ещё не входил).
  @Post('users/:id/send-access')
  sendUserAccess(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.sendUserAccess(id);
  }

  @Post('users/:id/reset-password')
  @RequirePermissions(Permission.Impersonate)
  resetUserPassword(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.adminService.resetUserPassword(id, user.role);
  }

  // Удалить сотрудника из компании (мягкое удаление: теряет доступ,
  // но история его разборов и закрытые спринты сохраняются). Опасно → только суперадмин.
  @Delete('companies/:id/users/:userId')
  @RequirePermissions(Permission.DeleteUser)
  removeCompanyUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    return this.adminService.removeCompanyUser(id, userId);
  }

  // Полное удаление компании (НЕОБРАТИМО, каскад по всем данным). Собственный гейт DeleteCompany:
  // класс-гейт CreateCompany есть и у трекера, а удалять компанию может ТОЛЬКО суперадмин (SEC-3-паттерн).
  @Delete('companies/:id')
  @RequirePermissions(Permission.DeleteCompany)
  deleteCompany(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteCompany(id);
  }

  // ── Управление трекерами (производственный отдел ЧиП) — только суперадмин ──
  @Get('trackers')
  @RequirePermissions(Permission.ManageTrackers)
  listTrackers() {
    return this.adminService.listTrackers();
  }

  @Post('trackers')
  @RequirePermissions(Permission.ManageTrackers)
  createTracker(@Body() dto: { fullName: string; email: string }) {
    return this.adminService.createTracker(dto);
  }

  @Patch('trackers/:id/active')
  @RequirePermissions(Permission.ManageTrackers)
  setTrackerActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: { isActive: boolean }) {
    return this.adminService.setTrackerActive(id, dto.isActive);
  }

  // Полное удаление трекера (НЕОБРАТИМО): освобождает email под новый аккаунт. Для тестовых трекеров.
  @Delete('trackers/:id')
  @RequirePermissions(Permission.ManageTrackers)
  deleteTracker(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.deleteTracker(id);
  }
}
