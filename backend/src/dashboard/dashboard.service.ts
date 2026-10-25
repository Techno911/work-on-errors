import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not } from 'typeorm';
import { Sprint } from '../sprints/entities/sprint.entity';
import { Entry } from '../entries/entities/entry.entity';
import { Company } from '../companies/entities/company.entity';
import { SprintStatus } from '../sprints/enums/sprint-status.enum';
import { weekBoundsFor, rampUpWeek, scaleThreshold } from '../common/company-time.util';
import { User } from '../users/entities/user.entity';
import { TEAM_ROLES, UserRole } from '../users/enums/user-role.enum';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { computeCompanyHealth } from '../companies/company-health.util';
import { AccessDeliveryService } from '../access/access-delivery.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { escapeTelegramHtml } from '../analytics/telegram.service';
import { StaffNotifierService } from '../analytics/staff-notifier.service';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';

type Zone = 'below' | 'good' | 'great';
function calcZone(count: number, good: number, great: number): Zone {
  if (count >= great) return 'great';
  if (count >= good) return 'good';
  return 'below';
}

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Sprint)
    private sprintsRepository: Repository<Sprint>,
    @InjectRepository(Entry)
    private entriesRepository: Repository<Entry>,
    @InjectRepository(Company)
    private companiesRepository: Repository<Company>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private readonly adminAccess: AccessDeliveryService,
    private readonly events: CompanyEventsService,
    private readonly notifications: NotificationsService,
    private readonly notifier: StaffNotifierService,
  ) {}

  /**
   * Экран состояния для собственника.
   *
   * Раньше собственнику отдавался экран РОПа, и при отсутствии данных за текущую неделю он
   * видел «Нет данных за текущий спринт»: ровно в тот момент, когда новость самая важная,
   * экран говорил, что новостей нет. Собственник заходит редко и задаёт три вопроса в одном
   * порядке: идёт работа или нет, кто именно её не делает, что от меня требуется. Экран
   * отвечает в этом порядке и заканчивается на этом.
   *
   * Имена вместо процентов сознательно: «Игорь не входил с 30 июля» рождает действие,
   * «вовлечённость 34 процента» не рождает ничего.
   */
  async getOwnerState(companyId: string) {
    const company = await this.companiesRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    // Только СДАННЫЕ записи, см. тот же комментарий в admin.service: брошенный черновик
    // обнулял отсчёт тишины, и экран собственника показывал работу там, где её нет.
    const lastEntry = await this.entriesRepository.findOne({
      where: { companyId, status: Not(EntryStatus.DRAFT) },
      order: { createdAt: 'DESC' },
    });
    const submittedTotal = await this.entriesRepository.count({
      where: [
        { companyId, status: EntryStatus.SUBMITTED },
        { companyId, status: EntryStatus.REVIEWED },
      ],
    });
    const reviewedTotal = await this.entriesRepository.count({
      where: { companyId, status: EntryStatus.REVIEWED },
    });
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const submittedLast7d = await this.entriesRepository
      .createQueryBuilder('e')
      .where('e."companyId" = :cid', { cid: companyId })
      .andWhere('e.status != :draft', { draft: EntryStatus.DRAFT })
      .andWhere('e."createdAt" >= :from', { from: weekAgo })
      .getCount();

    const team = (await this.usersRepository.find({
      where: { companyId, isActive: true },
      order: { createdAt: 'ASC' },
    })).filter((u) => TEAM_ROLES.includes(u.role) && u.role !== UserRole.OWNER);

    const staleDrafts = await this.entriesRepository.count({
      where: {
        companyId,
        status: EntryStatus.DRAFT,
        createdAt: LessThan(new Date(Date.now() - 2 * 86_400_000)),
      },
    });

    const health = computeCompanyHealth({
      status: company.status,
      startedAt: company.launchedAt ?? company.workStartedAt ?? company.createdAt,
      lastEntryAt: lastEntry?.createdAt ?? null,
      submittedLast7d,
      submittedTotal,
      reviewedTotal,
      neverLoggedIn: team.filter((u) => !u.lastLoginAt).length,
      staleDrafts,
      timezone: company.timezone,
      paymentHold: company.paymentHoldInfo?.startedAt
        ? { from: company.paymentHoldInfo.startedAt, to: company.paymentHoldInfo.liftedAt ?? null }
        : null,
    });

    // Кто именно не работает, поимённо и с датами. Считаем «подключённым» не по входу, а по
    // первой сданной записи: вход стоит тридцать секунд и ничего не доказывает.
    const people = await Promise.all(
      team.map(async (u) => {
        const submitted =
          u.role === UserRole.MANAGER
            ? await this.entriesRepository.count({
                where: [
                  { managerId: u.id, status: EntryStatus.SUBMITTED },
                  { managerId: u.id, status: EntryStatus.REVIEWED },
                ],
              })
            : await this.entriesRepository.count({ where: { reviewerId: u.id, status: EntryStatus.REVIEWED } });
        const roleLabel = u.role === UserRole.REVIEWER ? 'руководитель отдела продаж' : 'менеджер';
        let state: 'never_logged' | 'no_work' | 'ok';
        let note: string;
        if (!u.lastLoginAt) {
          state = 'never_logged';
          note = `заведён ${new Date(u.createdAt).toLocaleDateString('ru-RU')}, ни разу не входил`;
        } else if (submitted === 0) {
          state = 'no_work';
          note =
            u.role === UserRole.REVIEWER
              ? `последний вход ${new Date(u.lastLoginAt).toLocaleDateString('ru-RU')}, ни одного разбора`
              : `последний вход ${new Date(u.lastLoginAt).toLocaleDateString('ru-RU')}, ни одной сданной записи`;
        } else {
          state = 'ok';
          note =
            u.role === UserRole.REVIEWER
              ? `разобрано записей: ${submitted}`
              : `сдано записей: ${submitted}`;
        }
        return { id: u.id, fullName: u.fullName, roleLabel, state, note, neverLoggedIn: !u.lastLoginAt };
      }),
    );

    // Что требуется от собственника. Список короткий намеренно: три пункта человек читает,
    // десять пропускает целиком.
    const actions: Array<{ key: string; label: string; hint: string }> = [];
    const wa = company.reportChannels?.weeklyAccountability ?? {};
    if ((wa.telegramChatIds?.length ?? 0) === 0 && (wa.emails?.length ?? 0) === 0) {
      actions.push({
        key: 'channels',
        label: 'Подключить уведомления',
        hint: 'Пока канал не подключён, о проблемах в разборе звонков мы сообщить не сможем.',
      });
    }
    const notLogged = people.filter((p) => p.state === 'never_logged');
    if (notLogged.length) {
      actions.push({
        key: 'resend_access',
        label: 'Отправить доступы заново',
        hint: `Не вошли: ${notLogged.map((p) => p.fullName).join(', ')}. Чаще всего доступ до человека просто не дошёл.`,
      });
    }
    if (health.state === 'silent' || health.state === 'not_started') {
      actions.push({
        key: 'call_tracker',
        label: 'Позвать нашего трекера',
        hint: 'Разберёмся вместе, почему работа не идёт, и запустим её заново.',
      });
    }

    return {
      hasWorkChat: Boolean(company.telegramWorkChatId),
      companyName: company.name,
      // Наш операционный статус («Запуск», «На паузе») клиенту не показываем: это наша кухня.
      // Ему говорим «работа идёт» или «работа стоит с такого-то числа».
      work: { state: health.state, label: health.label, detail: health.detail, days: health.days },
      paused:
        company.status === 'paused'
          ? {
              reason: company.pauseInfo?.reason ?? null,
              expectedReturnAt: company.pauseInfo?.expectedReturnAt ?? null,
            }
          : null,
      people,
      actions,
      lastEntryAt: lastEntry?.createdAt ?? null,
      submittedTotal,
      reviewedTotal,
    };
  }

  /**
   * Собственник просит выслать доступы заново тем, кто не вошёл. Это его собственная команда,
   * поэтому действие принадлежит ему, а не только трекеру: у клиента ровно эта кнопка отсутствовала,
   * и владелец четыре дня не мог сделать ничего, кроме как написать нам.
   */
  async resendAccess(companyId: string, actorId: string): Promise<{ sent: number; failed: string[] }> {
    const company = await this.companiesRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    if (!company.telegramWorkChatId) {
      throw new BadRequestException('Рабочий чат не подключён: отправлять доступы некуда. Напишите нам, поможем подключить.');
    }
    const team = (await this.usersRepository.find({ where: { companyId, isActive: true } })).filter(
      (u) => TEAM_ROLES.includes(u.role) && !u.lastLoginAt,
    );
    if (!team.length) throw new BadRequestException('Все уже входили на платформу: высылать доступы некому');

    const failed: string[] = [];
    let sent = 0;
    for (const member of team) {
      try {
        await this.adminAccess.sendUserAccess(member.id);
        sent++;
      } catch (err) {
        failed.push(`${member.fullName}: ${(err as Error).message}`);
      }
    }
    await this.events.log({
      companyId,
      type: CompanyEventType.ACCESS_SENT,
      title: `Владелец выслал доступы заново (${sent} чел.)`,
      details: failed.length ? `Не ушли: ${failed.join('; ')}` : 'Именные ссылки входа отправлены в рабочий чат.',
      actorUserId: actorId,
    });
    return { sent, failed };
  }

  /**
   * Владелец зовёт нашего трекера прямо с экрана состояния. Одно действие вместо переписки:
   * человек, который видит «работа стоит 31 день», должен иметь возможность позвать нас в один
   * клик, а не искать, кому написать.
   */
  async callTracker(companyId: string, actor: User): Promise<{ requested: true }> {
    const company = await this.companiesRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const staff = await this.usersRepository.find({
      where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
    });
    const message =
      `Компания «${company.name}»: владелец ${actor.fullName} просит подключиться. ` +
      `Позвал с экрана состояния, где видно, что работа над ошибками не идёт.`;
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.HELP_REQUESTED,
        title: `${company.name}: владелец зовёт трекера`,
        message,
        linkUrl: `/admin/company/${companyId}`,
        relatedId: companyId,
      });
    }
    await this.notifier.alert(
      'owner-sos',
      `🆘 <b>${escapeTelegramHtml(company.name)}</b>\n${escapeTelegramHtml(message)}`,
    );
    await this.events.log({
      companyId,
      type: CompanyEventType.STATUS_CHANGED,
      title: 'Владелец позвал трекера',
      details: message,
      actorUserId: actor.id,
      actorLabel: actor.fullName,
    });
    return { requested: true };
  }

  async getManagerData(companyId: string, managerId: string) {
    const company = await this.companiesRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    // Граница недели — по таймзоне компании, та же, что у спринтов
    const { startDate } = weekBoundsFor(company.timezone);
    const sprint = await this.sprintsRepository.findOne({
      where: { companyId, startDate, status: SprintStatus.ACTIVE },
    });

    // Новичок (ни одной записи за всё время) не должен видеть баннер дедлайна
    const totalEntriesAllTime = await this.entriesRepository.count({
      where: { managerId, companyId },
    });

    // Первые шаги завершаются по фактам за всё время, а не по данным текущей недели:
    // переход к новой неделе или отсутствие спринта не возвращает опытному человеку
    // учебную карточку. Критерий самоанализа тот же, что у progress.selfReviewCompleted
    // (непустое selfReviewCorrect), только без границы спринта. queryBuilder нужен, чтобы
    // исключить и null, и пустую строку одним условием.
    const selfReviewCount = await this.entriesRepository
      .createQueryBuilder('e')
      .where('e."managerId" = :managerId', { managerId })
      .andWhere('e."companyId" = :companyId', { companyId })
      .andWhere(`e."selfReviewCorrect" IS NOT NULL AND e."selfReviewCorrect" <> ''`)
      .andWhere('e."deletedAt" IS NULL')
      .getCount();
    const firstSteps = {
      hasEntries: totalEntriesAllTime > 0,
      hasSelfReview: selfReviewCount > 0,
    };

    if (!sprint) {
      return {
        sprint: null,
        progress: null,
        recentReviewed: [],
        totalEntriesAllTime,
        firstSteps,
        settings: this.mapSettings(company),
      };
    }

    const entries = await this.entriesRepository.find({
      where: { sprintId: sprint.id, managerId },
      relations: ['errorTags'],
      order: { updatedAt: 'DESC' },
    });

    // Прогресс менеджера: записи, отправленные на ревью или уже проверенные
    // (менеджер сделал свою работу в момент отправки — это его KPI)
    const callCount = entries.filter(e => e.type === 'call' && (e.status === 'submitted' || e.status === 'reviewed')).length;
    const chatCount = entries.filter(e => e.type === 'chat' && (e.status === 'submitted' || e.status === 'reviewed')).length;

    // Разгонная неделя (запуск не с понедельника): пороги урезаны пропорционально коротким дням.
    const { isRampUp, factor } = rampUpWeek(company);
    const goodCalls = scaleThreshold(company.thresholdGoodCalls, factor);
    const goodChats = scaleThreshold(company.thresholdGoodChats, factor);
    const greatCalls = scaleThreshold(company.thresholdGreatCalls, factor);
    const greatChats = scaleThreshold(company.thresholdGreatChats, factor);

    const callZone = company.callsEnabled
      ? calcZone(callCount, goodCalls, greatCalls)
      : null;
    const chatZone = company.chatsEnabled
      ? calcZone(chatCount, goodChats, greatChats)
      : null;

    const zones = [callZone, chatZone].filter((z): z is Zone => z !== null);
    const overallZone: Zone = zones.includes('below')
      ? 'below'
      : zones.includes('good')
        ? 'good'
        : 'great';

    const recentReviewed = entries
      .filter(e => e.status === 'reviewed' && e.reviewText)
      .slice(0, 3);

    return {
      sprint,
      progress: {
        calls: company.callsEnabled
          ? { count: callCount, thresholdGood: goodCalls, thresholdGreat: greatCalls, zone: callZone }
          : null,
        chats: company.chatsEnabled
          ? { count: chatCount, thresholdGood: goodChats, thresholdGreat: greatChats, zone: chatZone }
          : null,
        overallZone,
        isRampUp,
        rampUpFactor: factor,
        selfReviewCompleted: entries.filter(e => e.selfReviewCorrect).length,
        reviewedByRop: entries.filter(e => e.status === 'reviewed').length,
      },
      recentReviewed: recentReviewed.map(e => ({
        id: e.id,
        type: e.type,
        entryNumber: e.entryNumber,
        reviewText: e.reviewText,
        status: e.status,
        updatedAt: e.updatedAt,
      })),
      totalEntriesAllTime,
      firstSteps,
      settings: this.mapSettings(company),
    };
  }

  async getReviewerData(companyId: string, reviewerId?: string) {
    const company = await this.companiesRepository.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const { startDate } = weekBoundsFor(company.timezone);
    const sprint = await this.sprintsRepository.findOne({
      where: { companyId, startDate, status: SprintStatus.ACTIVE },
    });

    // Первые шаги РОПа: один измеримый факт — хотя бы одно ревью за всё время в своей
    // компании. Пустая очередь и новая неделя его не имитируют: reviewedAt IS NOT NULL
    // пишется только по факту разбора.
    const firstSteps = {
      hasReviews: reviewerId
        ? (await this.entriesRepository
            .createQueryBuilder('e')
            .where('e."reviewerId" = :reviewerId', { reviewerId })
            .andWhere('e."companyId" = :companyId', { companyId })
            .andWhere('e."reviewedAt" IS NOT NULL')
            .andWhere('e."deletedAt" IS NULL')
            .getCount()) > 0
        : false,
    };

    if (!sprint) {
      return {
        sprint: null,
        pendingCount: 0,
        teamMembers: [],
        firstSteps,
        settings: this.mapSettings(company),
      };
    }

    const entries = await this.entriesRepository.find({
      where: { sprintId: sprint.id },
      relations: ['manager'],
    });

    const pendingCount = entries.filter(e => e.status === 'submitted').length;

    // Group by manager
    const managerMap = new Map<string, { manager: Entry['manager']; entries: Entry[] }>();
    for (const entry of entries) {
      if (!managerMap.has(entry.managerId)) {
        managerMap.set(entry.managerId, { manager: entry.manager, entries: [] });
      }
      managerMap.get(entry.managerId)!.entries.push(entry);
    }

    const teamMembers = Array.from(managerMap.entries())
      .sort((a, b) => (a[1].manager?.fullName ?? '').localeCompare(b[1].manager?.fullName ?? ''))
      .map(([managerId, { manager, entries: mEntries }]) => {
        const callCount = mEntries.filter(e => e.type === 'call').length;
        const chatCount = mEntries.filter(e => e.type === 'chat').length;
        const pendingMgr = mEntries.filter(e => e.status === 'submitted').length;
        const reviewedMgr = mEntries.filter(e => e.status === 'reviewed').length;

        return {
          id: managerId,
          fullName: manager?.fullName ?? 'Менеджер',
          color: manager?.color ?? null,
          callCount,
          chatCount,
          pendingCount: pendingMgr,
          reviewedCount: reviewedMgr,
          entriesCount: mEntries.length,
        };
      });

    return {
      sprint,
      pendingCount,
      teamMembers,
      firstSteps,
      settings: this.mapSettings(company),
    };
  }

  private mapSettings(company: Company) {
    return {
      callsEnabled: company.callsEnabled,
      chatsEnabled: company.chatsEnabled,
      callsPerWeek: company.callsPerWeek,
      chatsPerWeek: company.chatsPerWeek,
      minSelfReviewCorrectChars: company.minSelfReviewCorrectChars,
      minSelfReviewImproveChars: company.minSelfReviewImproveChars,
      minSelfReviewSuggestionsChars: company.minSelfReviewSuggestionsChars,
      minReviewChars: company.minReviewChars,
      thresholdGoodCalls: company.thresholdGoodCalls,
      thresholdGoodChats: company.thresholdGoodChats,
      thresholdGreatCalls: company.thresholdGreatCalls,
      thresholdGreatChats: company.thresholdGreatChats,
      managerDeadlineDay: company.managerDeadlineDay,
      reviewerDeadlineDay: company.reviewerDeadlineDay,
    };
  }
}
