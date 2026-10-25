import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Not, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { join, extname } from 'path';
import * as fs from 'fs';
import * as bcrypt from 'bcryptjs';
import { Company, CompanyStatus, LicenseMode, COMPANY_STATUS_LABEL as STATUS_LABEL } from '../companies/entities/company.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { Entry } from '../entries/entities/entry.entity';
import { User } from '../users/entities/user.entity';
import { SprintStatus } from '../sprints/enums/sprint-status.enum';
import { CreateCompanyDto } from '../companies/dto/create-company.dto';
import { assessLoopProtection } from '../companies/loop-protection.util';
import { TEAM_ROLES, UserRole } from '../users/enums/user-role.enum';
import { AnalyticsService } from '../analytics/analytics.service';
import { TelegramService, computeTrialEnd, escapeTelegramHtml } from '../analytics/telegram.service';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { RopBonusService } from '../rop-bonus/rop-bonus.service';
import { extractRequisites } from './requisites-extract';
import { AccessMember, buildAccessBlock, LAUNCH_MESSAGE_DEFAULT, PLATFORM_URL } from './launch-message';
import { NORM_PRESETS, type NormPresetName } from '../companies/norm-presets';
import { diffNorms } from '../companies/norm-diff';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';
import { computeCompanyHealth, type CompanyHealth } from '../companies/company-health.util';
import { AccessDeliveryService } from '../access/access-delivery.service';

// multer/busboy (defParamCharset='latin1') отдаёт UTF-8-байты имени файла как latin1 —
// кириллица превращается в «Ð§Ð Ð». Перекодируем обратно; для ASCII-имён строка не меняется.
// Берём utf8-версию только если она валидна (без replacement-символа), иначе оставляем исходную.
function decodeFileName(name: string): string {
  if (!name) return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

// SEC-4: magic-bytes реального содержимого файла против заявленного расширения — расширение
// имени легко подделать переименованием произвольного файла.
const CONTRACT_MAGIC_BYTES: Record<string, Buffer[]> = {
  '.docx': [Buffer.from([0x50, 0x4b, 0x03, 0x04])], // ZIP (OOXML)
  '.doc': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], // OLE2 CFB
  '.pdf': [Buffer.from('%PDF-', 'ascii')],
  '.rtf': [Buffer.from('{\\rtf', 'ascii')],
};

function isValidContractFile(filePath: string, ext: string): boolean {
  const signatures = CONTRACT_MAGIC_BYTES[ext];
  if (!signatures) return false;
  const maxLen = Math.max(...signatures.map((s) => s.length));
  let head: Buffer;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(maxLen);
    const bytesRead = fs.readSync(fd, buf, 0, maxLen, 0);
    fs.closeSync(fd);
    head = buf.subarray(0, bytesRead);
  } catch {
    return false;
  }
  return signatures.some((sig) => head.subarray(0, sig.length).equals(sig));
}

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Company) private companiesRepo: Repository<Company>,
    @InjectRepository(Sprint) private sprintsRepo: Repository<Sprint>,
    @InjectRepository(Entry) private entriesRepo: Repository<Entry>,
    @InjectRepository(User) private usersRepo: Repository<User>,
    @InjectRepository(RefreshToken) private refreshTokenRepo: Repository<RefreshToken>,
    private readonly analyticsService: AnalyticsService,
    private readonly telegram: TelegramService,
    private readonly ropBonusService: RopBonusService,
    private readonly notifications: NotificationsService,
    private readonly events: CompanyEventsService,
    private readonly accessDelivery: AccessDeliveryService,
  ) {}

  /**
   * Состав команды клиента изменился: сообщаем владельцу, РОПу и нам.
   *
   * До 05.08.2026 заведение сотрудника не порождало ни одного события: у клиента двух менеджеров
   * завели 30 июля, и об этом не узнал никто, включая собственника, который сам же их и просил
   * добавить. У этого события нет исполнителя, который мог бы что-то «починить», есть только
   * тот, кто должен знать, поэтому сигнал идёт владельцу сразу, минуя нижние ступени.
   * Не критично для самой операции: сбой уведомления не должен ронять заведение человека.
   */
  private async notifyTeamChange(company: Company, kind: 'added' | 'removed', person: User): Promise<void> {
    try {
      const roleLabel = AdminService.ROLE_LABEL[person.role] ?? 'сотрудник';
      const verb = kind === 'added' ? 'добавлен в команду' : 'убран из команды';
      const title = kind === 'added' ? 'В команде новый человек' : 'Сотрудник убран из команды';
      const message =
        kind === 'added'
          ? `${person.fullName} (${roleLabel}) ${verb} на платформе «Работа над ошибками». ` +
            `Доступ создан, ждём первый вход. Как только человек войдёт, работа по нему пойдёт в общий счёт команды.`
          : `${person.fullName} (${roleLabel}) ${verb}. Разборы и история остаются в платформе, ` +
            `недельный норматив команды пересчитан на оставшийся состав.`;

      const team = await this.usersRepo.find({ where: { companyId: company.id, isActive: true } });
      const audience = team.filter(
        (u) => u.id !== person.id && (u.role === UserRole.OWNER || u.role === UserRole.REVIEWER),
      );
      const staff = await this.usersRepo.find({
        where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
      });
      for (const u of audience) {
        await this.notifications.create({
          userId: u.id,
          type: NotificationType.TEAM_CHANGED,
          title,
          message,
          linkUrl: '/settings',
          relatedId: person.id,
        });
      }
      for (const s of staff) {
        await this.notifications.create({
          userId: s.id,
          type: NotificationType.TEAM_CHANGED,
          title: `${company.name}: ${title.toLowerCase()}`,
          message,
          linkUrl: `/admin/company/${company.id}`,
          relatedId: person.id,
        });
      }

      // Владелец заходит редко, поэтому колокольчик для него это архив, а не доставка.
      const ownerChats = company.reportChannels?.weeklyAccountability?.telegramChatIds ?? [];
      if (ownerChats.length) {
        await this.telegram.sendToMany(
          ownerChats,
          `👥 <b>${escapeTelegramHtml(company.name)}</b>\n${escapeTelegramHtml(message)}`,
        );
      }
    } catch (err) {
      // Сообщить не смогли, но человек заведён: операция важнее сигнала о ней.
      console.warn(`[team-change] уведомление не ушло: ${(err as Error).message}`);
    }
  }

  /** Лента событий компании для карточки трекера. */
  async getCompanyEvents(companyId: string, limit = 100) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    return this.events.list(companyId, limit);
  }

  /**
   * Здоровье работы компании по фактам (records → чистая функция computeCompanyHealth).
   * Считается системой и показывается РЯДОМ с ручным статусом: расхождение между ними видно
   * и требует ответа человека, а не молчаливого сосуществования двух правд.
   */
  async getCompanyHealth(company: Company): Promise<CompanyHealth> {
    // Только СДАННЫЕ записи: черновик до РОПа не доехал, работой он не является. Соседнее
    // поле submittedLast7d черновики исключало всегда, а «последняя запись» нет — из-за этого
    // брошенный черновик обнулял отсчёт тишины и компания выглядела живой (правка 09.08.2026).
    const lastEntry = await this.entriesRepo.findOne({
      where: { companyId: company.id, status: Not(EntryStatus.DRAFT) },
      order: { createdAt: 'DESC' },
    });
    const submittedTotal = await this.entriesRepo.count({
      where: [
        { companyId: company.id, status: EntryStatus.SUBMITTED },
        { companyId: company.id, status: EntryStatus.REVIEWED },
      ],
    });
    const reviewedTotal = await this.entriesRepo.count({
      where: { companyId: company.id, status: EntryStatus.REVIEWED },
    });
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const submittedLast7d = await this.entriesRepo
      .createQueryBuilder('e')
      .where('e."companyId" = :cid', { cid: company.id })
      .andWhere('e.status != :draft', { draft: EntryStatus.DRAFT })
      .andWhere('e."createdAt" >= :from', { from: weekAgo })
      .getCount();
    const neverLoggedIn = (
      await this.usersRepo.find({ where: { companyId: company.id, isActive: true, lastLoginAt: IsNull() } })
    ).filter((u) => TEAM_ROLES.includes(u.role)).length;

    // Черновики, брошенные дольше двух суток: человек начал и застрял.
    const staleDrafts = await this.entriesRepo.count({
      where: {
        companyId: company.id,
        status: EntryStatus.DRAFT,
        createdAt: LessThan(new Date(Date.now() - 2 * 86_400_000)),
      },
    });

    return computeCompanyHealth({
      status: company.status,
      startedAt: company.launchedAt ?? company.workStartedAt ?? company.createdAt,
      lastEntryAt: lastEntry?.createdAt ?? null,
      submittedLast7d,
      submittedTotal,
      reviewedTotal,
      neverLoggedIn,
      staleDrafts,
      timezone: company.timezone,
      paymentHold: company.paymentHoldInfo?.startedAt
        ? { from: company.paymentHoldInfo.startedAt, to: company.paymentHoldInfo.liftedAt ?? null }
        : null,
    });
  }

  async getCompaniesWithMetrics() {
    const companies = await this.companiesRepo.find({ order: { createdAt: 'ASC' } });
    const today = new Date().toISOString().split('T')[0];

    return Promise.all(
      companies.map(async (company) => {
        const users = await this.usersRepo.find({
          where: { companyId: company.id, isActive: true },
        });
        const managers = users.filter((u) => u.role === 'manager');
        const reviewers = users.filter((u) => u.role === 'reviewer');
        const owners = users.filter((u) => u.role === 'owner');

        const sprint = await this.sprintsRepo.findOne({
          where: { companyId: company.id, status: SprintStatus.ACTIVE },
          order: { startDate: 'DESC' },
        });

        let currentSprint: {
          label: string;
          status: string;
          completionRate: number;
          entriesCount: number;
          reviewedCount: number;
          totalExpected: number;
        } | null = null;

        let health: 'good' | 'warning' | 'critical' = 'good';
        let lastActivityAt: Date | null = null;
        let pendingReviews = 0;
        let reviewCoverage: number | null = null;

        if (sprint) {
          const entries = await this.entriesRepo.find({ where: { sprintId: sprint.id } });
          const totalExpected = Math.max(
            (company.callsPerWeek + company.chatsPerWeek) * managers.length,
            1,
          );
          const completionRate = Math.round((entries.length / totalExpected) * 100);
          const reviewedCount = entries.filter((e) => e.status === 'reviewed').length;

          // Фидбэк-долг РОПа: сданные записи без ревью и покрытие ревью в текущем спринте
          const submittedTotal = entries.filter((e) => e.status !== 'draft').length;
          pendingReviews = submittedTotal - reviewedCount;
          reviewCoverage = submittedTotal > 0 ? Math.round((reviewedCount / submittedTotal) * 100) : null;

          const isOverdue = sprint.endDate < today;
          if (completionRate < 40 || isOverdue) health = 'critical';
          else if (completionRate < 70) health = 'warning';
          else health = 'good';

          const sortedEntries = [...entries].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          lastActivityAt = sortedEntries[0]?.updatedAt ?? null;

          currentSprint = {
            label: sprint.label,
            status: sprint.status,
            completionRate,
            entriesCount: entries.length,
            reviewedCount,
            totalExpected,
          };
        } else if (!company.onboardingCompleted) {
          health = 'warning';
        }

        // Защита петли: незащищённая конфигурация (уроки одного клиента) — всегда критический статус.
        const loopProtection = assessLoopProtection(company);
        if (!loopProtection.protected && company.isActive) health = 'critical';

        const daysQuiet = lastActivityAt
          ? Math.floor((Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000)
          : null;

        // Регулярность команды: серия недель, когда спринт закрывается полным составом.
        const teamStreak = await this.analyticsService.getCompanyTeamStreak(company.id, company);

        // Здоровье считает система (см. computeCompanyHealth). Ручной статус остаётся рядом,
        // и их расхождение показывается явно, а не прячется за одним бейджем.
        const computedHealth = await this.getCompanyHealth(company);

        // Прогноз премии РОПа за текущий месяц (только если премия включена — N1/PERF1:
        // раньше считали для КАЖДОЙ компании вхолостую, даже без ropBonus, плюс дублирующий
        // findOne компании внутри getMonthStats на каждой итерации).
        let ropBonusForecast: { onTimePct: number | null; currentAmount: number } | null = null;
        if (company.ropBonus?.enabled) {
          try {
            const bonus = await this.ropBonusService.getMonthStats(company.id, undefined, company);
            ropBonusForecast = { onTimePct: bonus.onTimePct, currentAmount: bonus.currentAmount };
          } catch { /* премия не должна ломать сводку */ }
        }

        return {
          id: company.id,
          name: company.name,
          onboardingCompleted: company.onboardingCompleted,
          offerAccepted: Boolean(company.offerAcceptedAt),
          // pending = есть токен, но не принята. Легаси без токена сюда не попадают (у них оферты нет).
          offerPending: Boolean(company.offerToken) && !company.offerAcceptedAt,
          managersCount: managers.length,
          reviewersCount: reviewers.length,
          ownersCount: owners.length,
          status: company.status,
          currentSprint,
          health,
          lastActivityAt,
          daysQuiet,
          pendingReviews,
          reviewCoverage,
          loopProtected: loopProtection.protected,
          loopProtectionReasons: loopProtection.reasons,
          teamStreak: teamStreak.currentStreak,
          teamStreakHasTeam: teamStreak.hasTeam,
          ropBonusForecast,
          computedHealth,
          pauseInfo: company.status === 'paused' ? company.pauseInfo ?? {} : null,
        };
      }),
    );
  }

  async getCompanyDetails(companyId: string) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const users = await this.usersRepo.find({ where: { companyId, isActive: true } });
    const sprint = await this.sprintsRepo.findOne({
      where: { companyId, status: SprintStatus.ACTIVE },
      order: { startDate: 'DESC' },
    });

    const managersProgress = await Promise.all(
      users
        .filter((u) => u.role === 'manager')
        .map(async (manager) => {
          const entries = sprint
            ? await this.entriesRepo.find({ where: { managerId: manager.id, sprintId: sprint.id } })
            : [];
          return {
            id: manager.id,
            fullName: manager.fullName,
            email: manager.email,
            color: manager.color,
            entriesCount: entries.length,
            submittedCount: entries.filter((e) => e.status !== 'draft').length,
            reviewedCount: entries.filter((e) => e.status === 'reviewed').length,
          };
        }),
    );

    const launch = await this.getLaunchState(companyId, users);
    const computedHealth = await this.getCompanyHealth(company);
    return { company, managersProgress, sprint, launch, computedHealth };
  }

  /**
   * Фаза «Запуск»: события первого оборота петли для чек-листа на карточке компании.
   * Не настройки, а факты работы: команда вошла → запись → самоанализ → разбор РОПа.
   */
  private async getLaunchState(companyId: string, users: User[]) {
    const teamEntered = users.some(
      (u) =>
        (u.role === UserRole.MANAGER || u.role === UserRole.REVIEWER) &&
        Boolean(u.pdnConsentAcceptedAt || u.onboardingSeenAt),
    );
    const totalEntries = await this.entriesRepo.count({ where: { companyId } });
    const submitted = await this.entriesRepo.count({
      where: [
        { companyId, status: EntryStatus.SUBMITTED },
        { companyId, status: EntryStatus.REVIEWED },
      ],
    });
    const reviewed = await this.entriesRepo.count({ where: { companyId, status: EntryStatus.REVIEWED } });
    return {
      teamEntered,
      hasEntry: totalEntries > 0,
      hasSelfReview: submitted > 0,
      hasReview: reviewed > 0,
      // Черновик и хвост едут вместе: трекер видит в карточке всё сообщение целиком, а не
      // обещание «доступы ниже» и пустоту под ним (замечено 19.07). Оба — из launch-message.ts.
      draftDefault: LAUNCH_MESSAGE_DEFAULT,
      accessPreview: await this.buildAccessBlock(companyId, 'preview'),
    };
  }

  // Пароль для доставки в чат/показа трекеру: криптостойкий (crypto.randomBytes, не Math.random,
  // который предсказуем и позволяет за разумное время подобрать состояние генератора), 96 бит
  // энтропии — раньше формат «Слово+4 цифры» давал всего ~15,5 бит (5×9000 комбинаций),
  // перебираемых на живых аккаунтах владельцев/РОПов клиентов. base64url без паддинга: люди
  // копируют пароль кнопкой «Копировать», не печатают руками, читаемость не нужна.
  private genAccessPassword(): string {
    return randomBytes(12).toString('base64url');
  }

  private static readonly ROLE_LABEL: Partial<Record<UserRole, string>> = {
    [UserRole.OWNER]: 'владелец',
    [UserRole.REVIEWER]: 'РОП',
    [UserRole.MANAGER]: 'менеджер',
  };

  /** Именная ссылка первого входа. Живёт в AccessDeliveryService — одна на всю платформу. */
  async issueActivationLink(user: User): Promise<string> {
    return this.accessDelivery.issueActivationLink(user);
  }

  /**
   * Собирает участников хвоста с доступами. Режим 'send' попутно выпускает именные ссылки
   * первого входа — но только не входившим: у входившего свой пароль, и трогать его нельзя.
   * Сам текст блока верстает launch-message.ts, чтобы превью и отправка не разъехались.
   */
  private async buildAccessBlock(companyId: string, mode: 'send' | 'preview'): Promise<string> {
    const team = await this.usersRepo.find({ where: { companyId, isActive: true }, order: { createdAt: 'ASC' } });
    const members: AccessMember[] = [];
    for (const member of team) {
      const roleLabel = AdminService.ROLE_LABEL[member.role];
      if (!roleLabel) continue; // трекеры/суперадмины в чат команды не выносятся
      if (member.lastLoginAt) {
        members.push({ fullName: member.fullName, email: member.email, roleLabel, hasLoggedIn: true });
        continue;
      }
      let activationUrl: string | undefined;
      if (mode === 'send') {
        activationUrl = await this.issueActivationLink(member);
      }
      members.push({ fullName: member.fullName, email: member.email, roleLabel, hasLoggedIn: false, activationUrl });
    }
    return buildAccessBlock(members, mode);
  }

  /**
   * Запуск работы: ОДНО сообщение в рабочий чат = инструкция первой недели + доступы команды.
   * Пароли платформа не знает (хеши), поэтому в момент запуска генерирует новые — но только
   * тем, кто ещё ни разу не входил (lastLoginAt = null): входившим смена сломала бы вход.
   * Пароли в чате скрыты телеграм-спойлером. От launchedAt сторож (launch.scheduler) считает
   * тишину и авто-переводит launch → active. Повторный запуск запрещён.
   */
  async launchCompany(companyId: string, message: string): Promise<{ launchedAt: Date }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (company.launchedAt) throw new ConflictException('Работа уже запущена');
    if (!company.telegramWorkChatId) {
      throw new BadRequestException('Сначала подключите рабочий чат: стартовое сообщение отправляется в него');
    }
    const text = message.trim();
    if (!text) throw new BadRequestException('Стартовое сообщение пустое');
    if (text.length > 3000) throw new BadRequestException('Стартовое сообщение длиннее 3000 символов');

    const accessBlock = await this.buildAccessBlock(companyId, 'send');

    const sent = await this.telegram.sendMessage(company.telegramWorkChatId, escapeTelegramHtml(text) + accessBlock);
    if (!sent) {
      throw new BadRequestException('Не удалось отправить сообщение в рабочий чат. Проверьте, что бот остался в чате, и попробуйте ещё раз');
    }
    company.launchedAt = new Date();
    // Онбординг компании закрывает трекер запуском, а не владелец мастером (мастера больше нет).
    // От этого флага зависят сторожа петли (loop-guard) и статус компании в списке.
    company.onboardingCompleted = true;
    await this.companiesRepo.save(company);
    await this.events.log({
      companyId,
      type: CompanyEventType.LAUNCHED,
      title: 'Работа запущена',
      details: 'Стартовое сообщение с доступами отправлено в рабочий чат. Сторож тишины включён.',
      payload: { launchedAt: company.launchedAt.toISOString() },
    });
    await this.events.logDelivery(companyId, 'telegram_work_chat', true, 'стартовое сообщение команде');
    return { launchedAt: company.launchedAt };
  }

  /**
   * Перезапуск работы: отдельное действие рядом с запуском.
   *
   * Первый запуск можно нажать один раз за жизнь компании, и это верно: kick-off бывает один.
   * Но после простоя нужен именно мини-старт, а не «снятие галочки»: команда уже видела, что
   * работу объявили и ничего не произошло, доверие отрицательное. Перезапуск ставит новую точку
   * отсчёта (launchedAt), возвращает статус «Запуск» и включает сторожа тишины заново — то есть
   * ситуация клиента, где нажатая кнопка не запускала ничего, становится невозможной.
   */
  async relaunchCompany(companyId: string, message: string, actor?: User): Promise<{ launchedAt: Date }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (!company.launchedAt) {
      throw new BadRequestException('Работа ещё не запускалась: используйте «Запустить работу»');
    }
    if (!company.telegramWorkChatId) {
      throw new BadRequestException('Сначала подключите рабочий чат: сообщение о возобновлении отправляется в него');
    }
    const text = message.trim();
    if (!text) throw new BadRequestException('Сообщение о возобновлении пустое');
    if (text.length > 3000) throw new BadRequestException('Сообщение длиннее 3000 символов');

    const accessBlock = await this.buildAccessBlock(companyId, 'send');
    const sent = await this.telegram.sendMessage(company.telegramWorkChatId, escapeTelegramHtml(text) + accessBlock);
    if (!sent) {
      await this.events.logDelivery(companyId, 'telegram_work_chat', false, 'сообщение о возобновлении работы');
      throw new BadRequestException('Не удалось отправить сообщение в рабочий чат. Проверьте, что бот остался в чате, и попробуйте ещё раз');
    }

    const prevLaunchedAt = company.launchedAt;
    company.launchedAt = new Date();
    company.status = 'launch';
    company.pauseInfo = {};
    company.onboardingCompleted = true;
    await this.companiesRepo.save(company);

    const idleDays = Math.floor((Date.now() - new Date(prevLaunchedAt).getTime()) / 86_400_000);
    await this.events.log({
      companyId,
      type: CompanyEventType.RELAUNCHED,
      title: 'Работа перезапущена',
      details:
        `Сообщение о возобновлении отправлено в рабочий чат, доступы разосланы заново. ` +
        `С прошлого запуска прошло ${idleDays} дн. Сторож тишины включён с нуля.`,
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
      payload: { previousLaunchedAt: new Date(prevLaunchedAt).toISOString(), launchedAt: company.launchedAt.toISOString() },
    });
    await this.events.logDelivery(companyId, 'telegram_work_chat', true, 'сообщение о возобновлении работы');
    return { launchedAt: company.launchedAt };
  }

  /** Персональная досылка доступа в рабочий чат (см. AccessDeliveryService). */
  async sendUserAccess(userId: string, actorId?: string): Promise<{ sent: boolean }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Сотрудник не найден');
    if (user.lastLoginAt) {
      throw new BadRequestException(
        'Сотрудник уже входил на платформу: именная ссылка нужна только для первого входа. Если пароль утерян, используйте «Забыли пароль» на странице входа',
      );
    }
    return this.accessDelivery.sendUserAccess(userId, actorId);
  }

  async createCompany(dto: CreateCompanyDto): Promise<Company> {
    const company = this.companiesRepo.create(dto);
    // Дефолт колонки в проде мог остаться старым (synchronize=false) — задаём явно:
    // транскрипция включена с лимитом, иначе РОП ревьюит звонки без текста (аудит 3.0)
    company.transcription = { enabled: true, monthlyMinutesLimit: 300 };
    // Онбординг-оферта: сразу выдаём одноразовый токен, чтобы мастер трекера
    // мог показать ссылку владельцу для принятия оферты (= договор + согласие ПДн + триал).
    company.offerToken = randomBytes(16).toString('hex');
    const saved = await this.companiesRepo.save(company);
    await this.events.log({
      companyId: saved.id,
      type: CompanyEventType.COMPANY_CREATED,
      title: 'Компания заведена',
      details: `Пространство создано. Следующий шаг: оферта и подключение рабочего чата.`,
    });
    return saved;
  }

  /**
   * Ссылка-оферта для существующей компании. Легаси-компании (созданы до оферты) токена не имеют —
   * генерируем по требованию, чтобы трекер мог отправить оферту владельцу. Уже принятую не трогаем.
   */
  async ensureOfferLink(companyId: string): Promise<{ offerToken: string | null; alreadyAccepted: boolean }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (company.offerAcceptedAt) {
      return { offerToken: null, alreadyAccepted: true };
    }
    if (!company.offerToken) {
      company.offerToken = randomBytes(16).toString('hex');
      await this.companiesRepo.save(company);
    }
    return { offerToken: company.offerToken, alreadyAccepted: false };
  }

  /**
   * Код привязки рабочего ТГ-чата к компании. Трекер добавляет бота админом в чат и постит
   * там «/bind <code>». Бот фиксирует чат и старт работы (Bot API не видит историю до добавления).
   */
  async ensureBindCode(companyId: string): Promise<{ bindCode: string | null; botUsername: string | null; chatId: string | null }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const botUsername = await this.telegram.getBotUsername();
    if (company.telegramWorkChatId) {
      return { bindCode: null, botUsername, chatId: company.telegramWorkChatId };
    }
    if (!company.telegramBindCode) {
      // короткий буквенно-цифровой код, легко ввести в чате
      company.telegramBindCode = randomBytes(6).toString('hex');
      await this.companiesRepo.save(company);
    }
    return { bindCode: company.telegramBindCode, botUsername, chatId: null };
  }

  /** Обнаруженные боты-чаты (куда добавили бота), ещё не привязанные к компании. */
  async listDetectedChats() {
    const chats = await this.telegram.listUnboundChats();
    return chats.map(c => ({ chatId: c.chatId, title: c.title, isAdmin: c.isAdmin }));
  }

  /** Привязать обнаруженный чат к компании (кнопка в платформе, без команды в чате клиента). */
  async bindDetectedChat(companyId: string, chatId: string): Promise<Company> {
    return this.telegram.bindDetectedChat(companyId, chatId);
  }

  /** Дёрнуть опрос апдейтов сейчас (кнопка «Проверить»): свежие my_chat_member подтянутся. */
  async pollTelegramNow(): Promise<void> {
    await this.telegram.pollUpdates();
  }

  /** Жизненный статус компании (бейдж трекера): launch/active/paused/closed/demo. */
  async setCompanyStatus(companyId: string, status: CompanyStatus, actor?: User): Promise<Company> {
    const allowed: CompanyStatus[] = ['launch', 'active', 'paused', 'closed', 'demo'];
    if (!allowed.includes(status)) throw new BadRequestException('Некорректный статус компании');
    // Пауза без причины и даты возврата больше не выражается: она оформляется отдельным
    // действием с обязательными полями. Это конструкция, а не просьба в подсказке — иначе
    // пауза снова станет ярлыком без срока (разбор жизненного цикла, дефект 2).
    if (status === 'paused') {
      throw new BadRequestException(
        'Пауза оформляется кнопкой «Поставить на паузу»: нужны причина, планируемая дата возврата и ответственный',
      );
    }
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const from = company.status;
    if (from === status) return company;

    const wasPaused = from === 'paused';
    company.status = status;
    if (wasPaused) company.pauseInfo = {};
    const saved = await this.companiesRepo.save(company);

    await this.events.log({
      companyId,
      type: wasPaused ? CompanyEventType.RESUMED : CompanyEventType.STATUS_CHANGED,
      title: wasPaused
        ? `Пауза снята, статус «${STATUS_LABEL[status]}»`
        : `Статус: «${STATUS_LABEL[from]}» → «${STATUS_LABEL[status]}»`,
      details: wasPaused ? 'Компания вернулась в работу. Сигналы команде клиента снова идут.' : null,
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
      payload: { from, to: status },
    });
    return saved;
  }

  /**
   * Поставить компанию на паузу с условиями. Пауза приглушает то, что мы шлём КОМАНДЕ клиента,
   * и ничего не приглушает из того, что мы шлём себе: из наблюдения нельзя выпасть ни в одном
   * состоянии, можно только сменить порог тревоги.
   */
  async pauseCompany(
    companyId: string,
    dto: { reason: string; expectedReturnAt: string; responsible?: string; conditionToEnd?: string },
    actor?: User,
  ): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const reason = (dto?.reason ?? '').trim();
    if (!reason) throw new BadRequestException('Укажите причину паузы одной строкой');
    const returnAt = new Date(dto?.expectedReturnAt ?? '');
    if (isNaN(returnAt.getTime())) throw new BadRequestException('Укажите планируемую дату возврата');
    const now = new Date();
    if (returnAt.getTime() < now.getTime() - 86_400_000) {
      throw new BadRequestException('Дата возврата в прошлом: пауза должна кончаться в будущем');
    }
    // Предельный срок паузы по регламенту блока: 30 дней плюс продление ещё на 30 решением
    // владельца. Дальше блок считается прерванным по инициативе клиента и пересчитывается
    // письменно, поэтому паузу «на полгода» платформа не оформляет.
    const maxDays = 60;
    const days = Math.ceil((returnAt.getTime() - now.getTime()) / 86_400_000);
    if (days > maxDays) {
      throw new BadRequestException(
        `Пауза дольше ${maxDays} дней не оформляется: после 60 дней блок считается прерванным и сроки пересчитываются письменно`,
      );
    }

    company.status = 'paused';
    company.pauseInfo = {
      reason,
      startedAt: now.toISOString(),
      expectedReturnAt: returnAt.toISOString(),
      responsible: (dto?.responsible ?? '').trim() || undefined,
      conditionToEnd: (dto?.conditionToEnd ?? '').trim() || undefined,
    };
    const saved = await this.companiesRepo.save(company);

    await this.events.log({
      companyId,
      type: CompanyEventType.PAUSED,
      title: `Пауза до ${returnAt.toLocaleDateString('ru-RU')}`,
      details:
        `Причина: ${reason}.` +
        (company.pauseInfo.responsible ? ` Ответственный: ${company.pauseInfo.responsible}.` : '') +
        (company.pauseInfo.conditionToEnd ? ` Условие возврата: ${company.pauseInfo.conditionToEnd}.` : ''),
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
      payload: { expectedReturnAt: returnAt.toISOString(), days },
    });
    return saved;
  }

  /**
   * Приостановить работу компании за неоплату.
   *
   * Отличие от паузы принципиальное и потому это отдельное действие: пауза приглушает наши
   * сообщения, а приостановка закрывает вход команде клиента. Статус компании не трогаем: он
   * отвечает на вопрос «что с клиентом», а здесь ответ на вопрос «что с расчётами», и после
   * оплаты компания обязана вернуться ровно в то состояние, в котором была.
   */
  async holdForPayment(companyId: string, note: string | undefined, actor?: User): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (company.paymentHold) return company;

    const now = new Date();
    company.paymentHold = true;
    company.paymentHoldInfo = {
      startedAt: now.toISOString(),
      note: (note ?? '').trim() || undefined,
      byUserId: actor?.id,
      byLabel: actor?.fullName,
    };
    const saved = await this.companiesRepo.save(company);

    await this.events.log({
      companyId,
      type: CompanyEventType.PAYMENT_HOLD_ON,
      title: 'Работа приостановлена за неоплату',
      details:
        'Команда клиента видит экран приостановки вместо платформы, данные сохранены. ' +
        'Напоминания и отчёты команде не уходят, наше наблюдение продолжается.' +
        (company.paymentHoldInfo.note ? ` Собственнику показано: ${company.paymentHoldInfo.note}` : ''),
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
      payload: { note: company.paymentHoldInfo.note ?? null },
    });
    return saved;
  }

  /** Снять приостановку за неоплату: команда возвращается к работе там же, где остановилась. */
  async releasePaymentHold(companyId: string, actor?: User): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (!company.paymentHold) throw new BadRequestException('Работа компании не приостановлена');

    const startedAt = company.paymentHoldInfo?.startedAt;
    const days = startedAt
      ? Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 86_400_000))
      : null;

    company.paymentHold = false;
    company.paymentHoldInfo = { ...company.paymentHoldInfo, liftedAt: new Date().toISOString() };
    const saved = await this.companiesRepo.save(company);

    await this.events.log({
      companyId,
      type: CompanyEventType.PAYMENT_HOLD_OFF,
      title: 'Приостановка за неоплату снята',
      details:
        'Команда клиента снова работает в платформе.' +
        (days !== null ? ` Приостановка длилась ${days} дн.` : ''),
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
      payload: { days },
    });
    return saved;
  }

  /**
   * Отметка «CRM подключать нечем»: у клиента нет CRM, телефония не отдаёт записи, звонки
   * идут с личных телефонов. Пока её нет, платформа сама напоминает команде о подключении:
   * до 10.08.2026 неподключённая CRM выглядела одинаково и когда так решили, и когда просто
   * забыли, а у одного клиента забыли, и команда девятнадцать звонков носила файлами руками.
   * Снятие отметки возвращает подсказки и обнуляет откладывание.
   */
  async setCrmNotApplicable(
    companyId: string,
    notApplicable: boolean,
    reason: string | undefined,
    actor?: User,
  ): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (notApplicable && !(reason ?? '').trim()) {
      throw new BadRequestException('Напишите причину: через полгода это решение должно быть понятно');
    }

    company.crmNotApplicable = notApplicable;
    company.crmNotApplicableInfo = notApplicable
      ? { reason: reason?.trim(), markedBy: actor?.fullName, markedAt: new Date().toISOString() }
      : {};
    if (!notApplicable) company.crmHintSnoozedUntil = null;
    const saved = await this.companiesRepo.save(company);

    await this.events.log({
      companyId,
      type: CompanyEventType.CRM_NOT_APPLICABLE,
      title: notApplicable ? 'CRM подключать нечем' : 'Подсказка о подключении CRM возвращена',
      details: notApplicable
        ? `Платформа больше не предлагает команде подключить CRM. Причина: ${reason?.trim()}`
        : 'Команда снова увидит подсказку о подключении CRM.',
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
    });
    return saved;
  }

  /** Снять паузу вручную (то же, что перевод статуса, но именованным действием). */
  async resumeCompany(companyId: string, actor?: User): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (company.status !== 'paused') throw new BadRequestException('Компания не на паузе');
    return this.setCompanyStatus(companyId, 'active', actor);
  }

  /** Ручная дата старта работы (когда бот не в чате/чат уже шёл): пересчитывает бесплатный период. */
  async setWorkStart(companyId: string, dateIso: string): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const date = new Date(dateIso);
    if (isNaN(date.getTime())) throw new BadRequestException('Некорректная дата');
    company.workStartedAt = date;
    // При режиме «уже внедрение» триал не считаем — лицензия бесплатна на весь этап внедрения.
    company.trialEndsAt = company.licenseMode === 'implementation' ? null : computeTrialEnd(date, company.trialDays);
    await this.companiesRepo.save(company);
    return company;
  }

  /** Режим лицензии: trial (бесплатный тест N дней) или implementation (уже внедрение, бесплатно). */
  async setLicenseMode(companyId: string, mode: LicenseMode, actor?: User): Promise<Company> {
    const allowed: LicenseMode[] = ['trial', 'implementation'];
    if (!allowed.includes(mode)) throw new BadRequestException('Некорректный режим лицензии');
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const was = company.licenseMode ?? 'trial';
    company.licenseMode = mode;
    // Если старт работы уже зафиксирован — сразу пересчитываем/снимаем триал под новый режим.
    if (company.workStartedAt) {
      company.trialEndsAt = mode === 'implementation' ? null : computeTrialEnd(company.workStartedAt, company.trialDays);
    }
    const saved = await this.companiesRepo.save(company);
    if (was !== mode) {
      const name = (m: LicenseMode) => (m === 'implementation' ? 'внедрение' : 'бесплатный тест');
      await this.events.log({
        companyId,
        type: CompanyEventType.LICENSE_MODE_CHANGED,
        title: `Режим лицензии: ${name(mode)}`,
        details: mode === 'implementation'
          ? `Было «${name(was)}». Счётчик бесплатного теста снят: лицензия бесплатна, пока идёт внедрение.`
          : `Было «${name(was)}». Снова считается бесплатный тест на ${company.trialDays} дней от старта работы.`,
        actorUserId: actor?.id ?? null,
        actorLabel: actor?.fullName ?? null,
        payload: { from: was, to: mode },
      });
    }
    return saved;
  }

  /** Сохранить/обновить реквизиты юрлица заказчика (заказчик оферты — юрлицо/ИП, а не бренд). */
  async saveLegalInfo(
    companyId: string,
    dto: Partial<Pick<import('../companies/entities/company.entity').LegalInfoData,
      'legalName' | 'inn' | 'kpp' | 'ogrn' | 'address' | 'signatory'>>,
  ): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    // Мержим, чтобы не затирать метаданные файла договора при правке реквизитов.
    const clean = (v?: string) => (typeof v === 'string' ? v.trim() : undefined);
    company.legalInfo = {
      ...company.legalInfo,
      ...(dto.legalName !== undefined ? { legalName: clean(dto.legalName) } : {}),
      ...(dto.inn !== undefined ? { inn: clean(dto.inn) } : {}),
      ...(dto.kpp !== undefined ? { kpp: clean(dto.kpp) } : {}),
      ...(dto.ogrn !== undefined ? { ogrn: clean(dto.ogrn) } : {}),
      ...(dto.address !== undefined ? { address: clean(dto.address) } : {}),
      ...(dto.signatory !== undefined ? { signatory: clean(dto.signatory) } : {}),
    };
    await this.companiesRepo.save(company);
    return company;
  }

  /**
   * Привязать загруженный файл договора к компании: сохраняем метаданные и пытаемся
   * автозаполнить реквизиты из PDF/Word. Свежераспознанное значение поля побеждает старое —
   * при «Заменить» новый документ обязан иметь возможность перекрыть данные предыдущего
   * (иначе реквизиты старого файла «залипают» и не обновляются). Если по полю ничего не
   * распознано — сохраняем то, что уже было (ручная правка трекера или прошлая версия);
   * распознанное трекер в любом случае проверяет глазами перед сохранением.
   */
  async attachContract(companyId: string, file: Express.Multer.File): Promise<Company> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    // SEC-4: fileFilter проверял только РАСШИРЕНИЕ имени — переименованный произвольный файл
    // (.exe → .docx) проходил на диск. Сверяем реальные magic-bytes с заявленным расширением.
    const filePath = join(process.cwd(), 'uploads', 'contracts', file.filename);
    if (!isValidContractFile(filePath, extname(file.originalname).toLowerCase())) {
      try { fs.unlinkSync(filePath); } catch { /* уже нет файла — не критично */ }
      throw new BadRequestException('Файл повреждён или не является настоящим Word/PDF/RTF документом');
    }

    const current = company.legalInfo ?? {};

    let extracted: Partial<Company['legalInfo']> = {};
    try {
      extracted = await extractRequisites(join(process.cwd(), 'uploads', 'contracts', file.filename));
    } catch {
      extracted = {}; // извлечение best-effort — сбой не ломает загрузку файла
    }
    const merged = (k: 'legalName' | 'inn' | 'kpp' | 'ogrn' | 'address' | 'signatory') =>
      (extracted[k] && String(extracted[k]).trim()) ? extracted[k] : current[k];

    company.legalInfo = {
      ...current,
      legalName: merged('legalName'),
      inn: merged('inn'),
      kpp: merged('kpp'),
      ogrn: merged('ogrn'),
      address: merged('address'),
      signatory: merged('signatory'),
      contractFileName: decodeFileName(file.originalname),
      contractStoredName: file.filename,
      contractUploadedAt: new Date().toISOString(),
    };
    await this.companiesRepo.save(company);
    return company;
  }

  /** Путь к файлу договора для авторизованной отдачи (договор содержит реквизиты — не публичный). */
  async resolveContractFile(companyId: string): Promise<{ absPath: string; fileName: string }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const stored = company.legalInfo?.contractStoredName;
    if (!stored) throw new NotFoundException('Договор не загружен');
    const absPath = join(process.cwd(), 'uploads', 'contracts', stored);
    if (!fs.existsSync(absPath)) throw new NotFoundException('Файл договора не найден');
    return { absPath, fileName: company.legalInfo?.contractFileName ?? stored };
  }

  /**
   * Применяет готовый режим нормативов к компании. Значения берутся из NORM_PRESETS (единственный
   * источник, общий с настройками владельца), поэтому трекер не может прислать произвольный набор.
   */
  async applyNormPreset(companyId: string, preset: NormPresetName, actor?: User) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const found = NORM_PRESETS[preset];
    if (!found) throw new BadRequestException('Неизвестный режим нормативов');
    // Снимок ДО присвоения: журнал должен назвать старое значение, а после Object.assign
    // старого уже нет ни в одном носителе.
    const before = { ...company } as unknown as Record<string, unknown>;
    Object.assign(company, found.data);
    await this.companiesRepo.save(company);
    await this.events.logNormsChange({
      companyId,
      changes: diffNorms(before, company as unknown as Record<string, unknown>),
      presetLabel: found.label,
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
    });
    return { applied: found.name, label: found.label };
  }

  async getCompanyUsers(companyId: string) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const users = await this.usersRepo.find({
      where: { companyId, isActive: true },
      order: { createdAt: 'ASC' },
    });

    return Promise.all(users.map(async u => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      role: u.role,
      color: u.color,
      createdAt: u.createdAt,
      // Для бейджа «ещё не входил» и кнопки «Доступ в чат» (true = ни разу не входил).
      neverLoggedIn: !u.lastLoginAt,
      // РОП без личной привязки к боту молча не получает утренний дайджест (loop-guard просто
      // пропускает его) — трекер должен видеть это в карточке, а не узнавать из свода через неделю.
      telegramLinked: Boolean(await this.telegram.findContactByUserId(u.id)),
    })));
  }

  async createCompanyUser(
    companyId: string,
    dto: { fullName: string; email: string; role: string },
  ) {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const allowedRoles: UserRole[] = [UserRole.MANAGER, UserRole.REVIEWER, UserRole.OWNER];
    if (!allowedRoles.includes(dto.role as UserRole)) {
      throw new BadRequestException('Недопустимая роль');
    }

    const normalizedEmail = dto.email.toLowerCase().trim();
    const existing = await this.usersRepo.findOne({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictException('Пользователь с таким email уже существует');

    // Пароль ставим случайный и НИКОМУ не показываем: человек задаст свой по именной ссылке.
    const hashedPassword = await bcrypt.hash(this.genAccessPassword(), 10);

    const user = this.usersRepo.create({
      fullName: dto.fullName,
      email: normalizedEmail,
      role: dto.role as UserRole,
      companyId,
      password: hashedPassword,
    });
    const saved = await this.usersRepo.save(user);
    await this.notifyTeamChange(company, 'added', saved);
    await this.events.log({
      companyId,
      type: CompanyEventType.MEMBER_ADDED,
      title: `В команду добавлен: ${saved.fullName}`,
      details: `Роль: ${AdminService.ROLE_LABEL[saved.role] ?? saved.role}. Доступ создан, ждём первый вход.`,
      payload: { userId: saved.id, role: saved.role },
    });

    // Трекеру отдаём именную ссылку входа, а не пароль: пароль, показанный один раз в
    // открытой вкладке, теряется при перезагрузке и провоцирует копировать его в переписку
    // (разбор жизненного цикла, «что стоит починить в любом случае»).
    const activationUrl = await this.issueActivationLink(saved);
    return {
      user: {
        id: saved.id,
        fullName: saved.fullName,
        email: saved.email,
        role: saved.role,
        color: saved.color,
        createdAt: saved.createdAt,
      },
      activationUrl,
    };
  }

  async resetUserPassword(userId: string, callerRole?: UserRole) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    // Пароль другого СУПЕРАДМИНА не сбрасываем никогда.
    if (user.role === UserRole.SUPERADMIN) {
      throw new BadRequestException('Пароль суперадмина здесь не сбрасывается');
    }
    // Пароль ТРЕКЕРА может сбросить только суперадмин («режим бога» — войти под трекером проверить
    // функционал). Трекеру служебные пароли по-прежнему недоступны (SEC-3: эндпоинт под Impersonate,
    // которого у трекера нет; здесь — второй барьер по роли вызывающего).
    if (user.role === UserRole.TRACKER && callerRole !== UserRole.SUPERADMIN) {
      throw new BadRequestException('Пароль трекера может сбросить только суперадмин');
    }

    const newPassword = this.genAccessPassword();
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await this.usersRepo.update(userId, { password: hashedPassword });
    // Сброс пароля даёт полный доступ под чужим именем не хуже impersonate — обрываем
    // прежние сессии жертвы тем же способом, что и самостоятельный сброс по email (TOK1).
    await this.refreshTokenRepo.update({ userId, isRevoked: false }, { isRevoked: true });

    return { userId, newPassword };
  }

  // Мягкое удаление сотрудника: ставит deleted_at (softDelete не каскадит на
  // записи разборов). Сотрудник пропадает из команды, метрик и сразу теряет
  // доступ (jwt-стратегия и refresh не находят soft-deleted пользователя),
  // при этом его прошлые разборы и закрытые спринты остаются в истории.
  async removeCompanyUser(companyId: string, userId: string) {
    const user = await this.usersRepo.findOne({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundException('Сотрудник не найден в этой компании');
    if (user.role === UserRole.OWNER) {
      throw new BadRequestException('Владельца удалить нельзя: это держатель аккаунта компании');
    }

    await this.usersRepo.softDelete(userId);
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (company) await this.notifyTeamChange(company, 'removed', user);
    await this.events.log({
      companyId,
      type: CompanyEventType.MEMBER_REMOVED,
      title: `Из команды убран: ${user.fullName}`,
      details: `Роль: ${AdminService.ROLE_LABEL[user.role] ?? user.role}. Разборы и история остаются в платформе.`,
      payload: { userId: user.id, role: user.role },
    });
    return { removed: true };
  }

  /**
   * Полное удаление компании суперадмином (НЕОБРАТИМО). В отличие от статуса «Закрыта» (архив),
   * физически удаляет все данные. Каскад собран вручную по FK-графу: часть таблиц ссылается на
   * companyId/userId без ON DELETE (sprints → companies, user_gamification/entries.manager/reviewer
   * → users, entries.sprintId → sprints — все RESTRICT), поэтому удаляем в порядке от листьев к
   * корню в одной транзакции. entry_audio/entry_screenshots/entry_error_tags, refresh_tokens,
   * notifications уходят БД-каскадом за родителем. Файл договора чистим после коммита (best-effort).
   */
  async deleteCompany(companyId: string): Promise<{ deleted: true }> {
    const company = await this.companiesRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    await this.companiesRepo.manager.transaction(async (tx) => {
      // users — soft-delete: берём все id, включая помеченные deleted_at, чтобы не осталось сирот.
      const userRows: Array<{ id: string }> = await tx.query('SELECT id FROM users WHERE company_id = $1', [companyId]);
      const userIds = userRows.map((r) => r.id);
      const entryRows: Array<{ id: string }> = await tx.query('SELECT id FROM entries WHERE "companyId" = $1', [companyId]);
      const entryIds = entryRows.map((r) => r.id);
      const tplRows: Array<{ id: string }> = await tx.query('SELECT id FROM review_templates WHERE "companyId" = $1', [companyId]);
      const tplIds = tplRows.map((r) => r.id);

      // share-ссылки на записи компании (нет FK на entries — чистим до удаления записей)
      if (entryIds.length) await tx.query('DELETE FROM share_tokens WHERE "entryId" = ANY($1)', [entryIds]);
      // записи (БД-каскад снесёт entry_audio / entry_screenshots / entry_error_tags)
      await tx.query('DELETE FROM entries WHERE "companyId" = $1', [companyId]);
      // спринты (RESTRICT на companies; после удаления записей на них ничто не ссылается)
      await tx.query('DELETE FROM sprints WHERE "companyId" = $1', [companyId]);
      // геймификация сотрудников (user_gamification RESTRICT на users — снять до удаления)
      if (userIds.length) {
        await tx.query('DELETE FROM user_gamification WHERE "userId" = ANY($1)', [userIds]);
        await tx.query('DELETE FROM achievements WHERE "userId" = ANY($1)', [userIds]);
        await tx.query('DELETE FROM xp_transactions WHERE "userId" = ANY($1)', [userIds]);
      }
      // история шаблонов ревью (по templateId, без FK)
      if (tplIds.length) await tx.query('DELETE FROM review_template_history WHERE "templateId" = ANY($1)', [tplIds]);
      // Telegram-контакты сотрудников (нет FK на users — иначе осиротевшие username+chat_id переживут «полное удаление»)
      if (userIds.length) await tx.query('DELETE FROM telegram_contacts WHERE user_id = ANY($1)', [userIds]);
      // сотрудники (БД-каскад снесёт refresh_tokens и notifications; invites.invitedById → SET NULL)
      await tx.query('DELETE FROM users WHERE company_id = $1', [companyId]);
      // прочее, привязанное к компании без каскада
      await tx.query('DELETE FROM error_tags WHERE "companyId" = $1', [companyId]);
      await tx.query('DELETE FROM review_templates WHERE "companyId" = $1', [companyId]);
      await tx.query('DELETE FROM transcription_usage WHERE "companyId" = $1', [companyId]);
      await tx.query('DELETE FROM crm_connections WHERE company_id = $1', [companyId]);
      await tx.query('DELETE FROM rop_bonus_snapshots WHERE company_id = $1', [companyId]);
      await tx.query('DELETE FROM telegram_detected_chats WHERE bound_company_id = $1', [companyId]);
      await tx.query('DELETE FROM invites WHERE "companyId" = $1', [companyId]);
      // сама компания
      await tx.query('DELETE FROM companies WHERE id = $1', [companyId]);
    });

    // Файл договора на диске (данные в БД уже удалены — сбой удаления файла не критичен).
    try {
      const stored = company.legalInfo?.contractStoredName;
      if (stored) fs.rmSync(join(process.cwd(), 'uploads', 'contracts', stored), { force: true });
    } catch { /* некритично */ }

    return { deleted: true };
  }

  // ── Управление трекерами (только суперадмин) ──────────────────────────────
  // Трекер — служебный пользователь ЧиП без companyId: видит все компании и ведёт
  // онбординг, но без опасных действий суперадмина (см. DEFAULT_ROLE_PERMISSIONS).
  async listTrackers() {
    const trackers = await this.usersRepo.find({
      where: { role: UserRole.TRACKER },
      order: { createdAt: 'ASC' },
    });
    return trackers.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      email: t.email,
      isActive: t.isActive,
      createdAt: t.createdAt,
    }));
  }

  async createTracker(dto: { fullName: string; email: string }) {
    const normalizedEmail = dto.email.toLowerCase().trim();
    if (!dto.fullName?.trim()) throw new BadRequestException('Укажите имя трекера');
    if (!normalizedEmail) throw new BadRequestException('Укажите email трекера');
    const existing = await this.usersRepo.findOne({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictException('Пользователь с таким email уже существует');

    const tempPassword = this.genAccessPassword();
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    const user = this.usersRepo.create({
      fullName: dto.fullName.trim(),
      email: normalizedEmail,
      role: UserRole.TRACKER,
      companyId: null,
      password: hashedPassword,
    });
    const saved = await this.usersRepo.save(user);
    return {
      tracker: { id: saved.id, fullName: saved.fullName, email: saved.email, isActive: saved.isActive, createdAt: saved.createdAt },
      tempPassword,
    };
  }

  async setTrackerActive(userId: string, isActive: boolean) {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.TRACKER) throw new NotFoundException('Трекер не найден');
    await this.usersRepo.update(userId, { isActive });
    return { id: userId, isActive };
  }

  /**
   * Полное удаление трекера (НЕОБРАТИМО): физически стирает строку, освобождая email под новый
   * аккаунт (для тестовых трекеров, чтобы не копить занятые почты). Трекер не привязан к компаниям
   * FK-графом и не бывает менеджером/РОПом (entries его не держат). Каскад по FK на users:
   * refresh_tokens/notifications → CASCADE (снимет БД), invites.invitedById → SET NULL. Строку
   * user_gamification (NO ACTION, у трекера обычно нет) снимаем на всякий случай; crm_connections
   * .created_by — не FK, обнуляем для гигиены.
   */
  async deleteTracker(userId: string): Promise<{ deleted: true }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user || user.role !== UserRole.TRACKER) throw new NotFoundException('Трекер не найден');
    await this.usersRepo.manager.transaction(async (tx) => {
      await tx.query('DELETE FROM user_gamification WHERE "userId" = $1', [userId]);
      await tx.query('DELETE FROM telegram_contacts WHERE user_id = $1', [userId]);
      await tx.query('UPDATE crm_connections SET created_by = NULL WHERE created_by = $1', [userId]);
      await tx.query('DELETE FROM users WHERE id = $1', [userId]);
    });
    return { deleted: true };
  }
}
