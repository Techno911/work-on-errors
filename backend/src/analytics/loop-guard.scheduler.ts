import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { Company, DEFAULT_REVIEW_NORMS } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { TEAM_ROLES, UserRole } from '../users/enums/user-role.enum';
import { Sprint } from '../sprints/entities/sprint.entity';
import { SprintStatus } from '../sprints/enums/sprint-status.enum';
import { assessLoopProtection } from '../companies/loop-protection.util';
import { businessHoursBetween, idleWorkingDays, localParts, workingDaysSince } from '../common/company-time.util';
import { TelegramService, escapeTelegramHtml as esc } from './telegram.service';
import { RopBonusService } from '../rop-bonus/rop-bonus.service';
import { pluralRu } from './weekly-report.scheduler';
import { OwnerReachService } from './owner-reach.service';
import { canSignalClient, isUnderOurWatch } from '../companies/signal-audience.util';
import { StaffNotifierService, StaffSignal } from './staff-notifier.service';

/**
 * Защита петли разбора ошибок. Урок пилота одного клиента: менеджеры сдали 40 записей,
 * РОП молча проверил 4, никто не получил ни одного сигнала — петля умерла за неделю.
 * Три контура:
 *  1) будни 09:30 — личный дайджест РОПу: сколько записей ждут ревью (долг + деньги);
 *  2) ср/пт 14:00 — фидбэк-долг: покрытие ревью ниже порога → РОПу, в пятницу — владельцу;
 *  3) будни 09:00 — нам: незащищённые петли и «молчащие» компании, и ТОЛЬКО когда есть
 *     новость (см. StaffNotifierService): повтор вчерашней картины сообщением не является.
 */
@Injectable()
export class LoopGuardScheduler {
  private readonly logger = new Logger(LoopGuardScheduler.name);

  /**
   * Пороги свода в РАБОЧИХ днях клиента (решение владельца продукта: «в выходные люди не
   * работают»). Раньше стояли календарные семь и два, поэтому суббота с воскресеньем сами
   * по себе добавляли компании два дня «простоя», а выданный в пятницу доступ попадал в свод
   * воскресным утром. Пять рабочих дней это ровно рабочая неделя без единой записи.
   */
  private static readonly QUIET_WORKDAYS = 5;
  /** Столько же рабочих дней ждёт первого входа точечный сторож доступов. */
  private static readonly ACCESS_WORKDAYS = 2;

  constructor(
    @InjectRepository(Entry) private readonly entryRepo: Repository<Entry>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Sprint) private readonly sprintRepo: Repository<Sprint>,
    private readonly telegram: TelegramService,
    private readonly ropBonus: RopBonusService,
    private readonly ownerReach: OwnerReachService,
    private readonly notifier: StaffNotifierService,
  ) {}

  // ── 1. Личный дайджест РОПу ─────────────────────────────────────────────

  // Ежечасно на :30 — дайджест в 09:30 локального будничного утра компании
  @Cron('30 * * * *', { name: 'rop-daily-digest' })
  async ropDigest(): Promise<void> {
    if (!this.telegram.enabled) return;
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      // Пауза приглушает то, что мы шлём КОМАНДЕ клиента: дёргать РОПа компании, работа
      // которой официально остановлена, значит приучать его игнорировать наши сообщения.
      // Нам самим компания на паузе по-прежнему видна (свод ниже её не пропускает).
      // Закрытые и демонстрационные исключаются тем же фильтром: до 09.08.2026 их здесь
      // не было, и закрытый одного клиента с 36 неразобранными записями числился адресатом.
      if (!canSignalClient(company)) continue;
      const lp = localParts(company.timezone);
      if (lp.hour !== 9 || lp.isoWeekday > 5) continue;
      try {
        await this.sendRopDigest(company);
      } catch (err) {
        this.logger.error(`rop-digest ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  async sendRopDigest(company: Company, force = false): Promise<number> {
    const pending = await this.entryRepo.count({
      where: { companyId: company.id, status: EntryStatus.SUBMITTED },
    });
    if (pending === 0 && !force) return 0;

    const reviewers = await this.userRepo.find({
      where: { companyId: company.id, role: UserRole.REVIEWER, isActive: true },
    });
    if (reviewers.length === 0) return 0;

    let bonusLine = '';
    if (company.ropBonus?.enabled) {
      try {
        const stats = await this.ropBonus.getMonthStats(company.id, undefined, company);
        if (stats.onTimePct !== null) {
          bonusLine = `\nРевью в срок за месяц: <b>${stats.onTimePct}%</b> · премия сейчас: <b>${stats.currentAmount.toLocaleString('ru-RU')} ₽</b>`;
        }
      } catch { /* премия не должна ломать дайджест */ }
    }

    const msg =
      `📝 <b>${esc(company.name)}</b>\n` +
      `${pending} ${pending === 1 ? 'запись ждёт' : pending < 5 ? 'записи ждут' : 'записей ждут'} вашего ревью.` +
      bonusLine +
      `\n\nПлатформа: ${process.env.APP_URL || 'https://app.example.invalid'}/sprint`;

    let sent = 0;
    for (const rop of reviewers) {
      const contact = await this.telegram.findContactByUserId(rop.id);
      if (!contact) continue; // РОП без привязки попадёт в еженедельный свод суперадмину
      if (await this.telegram.sendMessage(contact.chatId, msg)) sent++;
    }
    this.logger.log(`[rop-digest] ${company.name}: pending=${pending}, sent=${sent}/${reviewers.length}`);
    return sent;
  }

  // ── 2. Фидбэк-долг: покрытие ревью в текущем спринте ────────────────────

  // Ежечасно: среда 14:00 локально → сигнал РОПу; пятница 14:00 локально → владельцу
  @Cron('0 * * * *', { name: 'feedback-debt' })
  async debtHourly(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      if (!canSignalClient(company)) continue; // см. комментарий в ropDigest
      const lp = localParts(company.timezone);
      if (lp.hour !== 14 || (lp.isoWeekday !== 3 && lp.isoWeekday !== 5)) continue;
      const friday = lp.isoWeekday === 5;
      try {
        await this.checkCompanyDebt(company, friday ? 80 : 50, friday);
      } catch (err) {
        this.logger.error(`feedback-debt ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  // Возвращает false при отсутствии данных/каналов (SCHED1: тестовая кнопка не должна врать «отправлено»).
  async checkCompanyDebt(company: Company, thresholdPct: number, escalateToOwner: boolean, force = false): Promise<boolean> {
    const sprint = await this.sprintRepo.findOne({
      where: { companyId: company.id, status: SprintStatus.ACTIVE },
      order: { startDate: 'DESC' },
    });
    if (!sprint) return false;

    const entries = await this.entryRepo.find({ where: { sprintId: sprint.id } });
    const submitted = entries.filter((e) => e.status !== EntryStatus.DRAFT);
    if (submitted.length === 0) return false; // нет сданного — нет долга

    const reviewed = submitted.filter((e) => e.status === EntryStatus.REVIEWED).length;
    const coverage = Math.round((reviewed / submitted.length) * 100);
    if (coverage >= thresholdPct && !force) return false;

    if (!escalateToOwner) {
      // Среда: личный сигнал РОПу — неделя ещё спасаема
      const reviewers = await this.userRepo.find({
        where: { companyId: company.id, role: UserRole.REVIEWER, isActive: true },
      });
      const msg =
        `⚠️ <b>${esc(company.name)}</b>: ревью отстаёт\n` +
        `Проверено ${reviewed} из ${submitted.length} сданных (${coverage}%).\n` +
        `Менеджеры без обратной связи перестают сдавать. Доведите ревью до конца недели.\n\n` +
        `Платформа: ${process.env.APP_URL || 'https://app.example.invalid'}/sprint`;
      let sent = 0;
      for (const rop of reviewers) {
        const contact = await this.telegram.findContactByUserId(rop.id);
        if (contact && (await this.telegram.sendMessage(contact.chatId, msg))) sent++;
      }
      this.logger.log(`[debt-wed] ${company.name}: coverage=${coverage}%`);
      return sent > 0;
    } else {
      // Пятница: эскалация владельцу по всем его адресам (раньше только Telegram-каналы,
      // а у обоих живых клиентов их нет: сигнал не уходил никогда).
      const msg =
        `🚨 <b>${esc(company.name)}</b>: записи команды без ревью\n` +
        `К концу недели проверено ${reviewed} из ${submitted.length} (${coverage}%, норма 80%).\n` +
        `Без обратной связи разбор ошибок останавливается. Стоит подтолкнуть РОПа: премия за этот месяц под угрозой.`;
      const delivery = await this.ownerReach.deliver(company, {
        kind: 'feedback-debt',
        tgHtml: msg,
        subject: `${company.name}: записи команды без ревью`,
        emailHtml:
          `<p><b>${company.name}</b>: записи команды без ревью.</p>` +
          `<p>К концу недели проверено ${reviewed} из ${submitted.length} (${coverage}%, норма 80%).</p>` +
          `<p>Без обратной связи разбор ошибок останавливается. Стоит подтолкнуть РОПа: ` +
          `премия за этот месяц под угрозой.</p>`,
      });
      this.logger.log(
        `[debt-fri] ${company.name}: coverage=${coverage}%, ` +
          `чатов=${delivery.chats}, писем=${delivery.emails}`,
      );
      return delivery.delivered;
    }
  }

  // ── 3. Свод суперадмину: незащищённые петли и молчащие компании ─────────

  // Будни: в субботу и воскресенье свод повторял бы пятничные строки, а действовать по ним
  // некому — ни у нас, ни у клиента нет рабочего дня (решение владельца продукта). Ручной
  // прогон (sendSuperadminHealth(true) из админки) выходных не знает и работает всегда.
  @Cron('0 9 * * 1-5', { name: 'superadmin-loop-health' })
  async superadminDaily(): Promise<void> {
    await this.sendSuperadminHealth();
  }

  /**
   * Считает картину целиком и отдаёт её StaffNotifierService, который сам решает, есть ли
   * тут новость. У каждой строки устойчивый идентификатор (проблема) и ступень (насколько
   * ей стало хуже) — по ним и отличается новость от вчерашнего состояния.
   *
   * `force` это ручной прогон из админки: человек спросил сам, поэтому получает картину
   * целиком, включая «всё чисто».
   */
  async sendSuperadminHealth(force = false): Promise<boolean> {
    if (!this.telegram.enabled) return false;

    const companies = await this.companyRepo.find({ where: { isActive: true } });
    const signals: StaffSignal[] = [];
    let checked = 0;

    for (const company of companies) {
      // Архив и демо в своде не нужны: работа там не идёт и идти не должна.
      // ПАУЗА ЗДЕСЬ ОСТАЁТСЯ (правка 05.08.2026). Раньше paused отсюда исключался «чтобы не шуметь»,
      // и это оказалось выключателем зрения, а не тишины: клиента простоял на паузе 111 дней с нулём
      // записей, и ни одна строка о нём сюда не попала. Пауза приглушает то, что мы шлём КОМАНДЕ
      // клиента, и ничего не приглушает из того, что мы шлём себе.
      if (!isUnderOurWatch(company)) continue;
      checked++;
      const paused = company.status === 'paused';
      // Приостановка за неоплату это НАШЕ решение и отдельная от паузы сущность: платформа
      // закрыта всей команде, сдать запись физически нельзя. До 13.08.2026 свод её не знал
      // вовсе и писал про клиента «8 дней без новых записей» без единой пометки, то есть выставлял
      // клиенту наш же счёт как его простой. Часы состояния останавливаются на дате закрытия.
      const holdSince =
        company.paymentHold && company.paymentHoldInfo?.startedAt
          ? new Date(company.paymentHoldInfo.startedAt)
          : null;
      const asOf = holdSince && holdSince.getTime() < Date.now() ? holdSince.getTime() : Date.now();
      // Окно приостановки целиком, включая уже снятую: дни, когда платформа была закрыта нами,
      // из простоя клиента вычитаются задним числом (иначе после снятия счётчик догоняет их).
      const holdWindow = company.paymentHoldInfo?.startedAt
        ? { from: company.paymentHoldInfo.startedAt, to: company.paymentHoldInfo.liftedAt ?? null }
        : null;
      const tag = paused ? ' (на паузе)' : company.paymentHold ? ' (доступ закрыт за неоплату)' : '';
      // Пауза в сводке это не исчезновение, а строка с сроком: «день 14 из 30, возврат 20 августа».
      if (paused) {
        const info = company.pauseInfo ?? {};
        if (info.expectedReturnAt) {
          const startedAt = info.startedAt ? new Date(info.startedAt) : null;
          const dayNo = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 86_400_000) : null;
          const total = startedAt
            ? Math.round((new Date(info.expectedReturnAt).getTime() - startedAt.getTime()) / 86_400_000)
            : null;
          const returnAt = new Date(info.expectedReturnAt).toLocaleDateString('ru-RU');
          signals.push({
            id: `pause:${company.id}`,
            // Ступень это план возврата: сдвинули дату — новость, идёт очередной день паузы — нет.
            stage: `${info.expectedReturnAt}`,
            text:
              `⏸ <b>${esc(company.name)}</b>: на паузе` +
              (dayNo !== null && total !== null ? `, день ${dayNo} из ${total}` : '') +
              `, возврат ожидается ${returnAt}` +
              (info.reason ? ` (${esc(info.reason)})` : ''),
          });
        } else {
          signals.push({
            id: `pause:${company.id}`,
            stage: 'no-plan',
            text: `⏸ <b>${esc(company.name)}</b>: на паузе без причины и даты возврата`,
          });
        }
      }
      // Приостановка держится в своде своей строкой, а не тегом на чужих: пока она висит,
      // работы у клиента не будет по нашей же воле, и это состояние, требующее решения о
      // деньгах, а не о дисциплине команды.
      if (company.paymentHold) {
        const dayNo = holdSince ? Math.floor((Date.now() - holdSince.getTime()) / 86_400_000) + 1 : null;
        signals.push({
          id: `hold:${company.id}`,
          // Ступень меняется раз в неделю закрытого доступа: решение о деньгах откладывать нельзя,
          // но и напоминать о нём каждый день бессмысленно.
          stage: dayNo !== null ? `w${Math.floor(dayNo / 7)}` : 'open',
          text:
            `💳 <b>${esc(company.name)}</b>: доступ закрыт за неоплату` +
            (holdSince ? ` с ${holdSince.toLocaleDateString('ru-RU')}` : '') +
            (dayNo !== null ? `, день ${dayNo}` : '') +
            (company.paymentHoldInfo?.note ? ` (${esc(company.paymentHoldInfo.note)})` : ''),
        });
      }
      const protection = assessLoopProtection(company);
      if (!protection.protected && company.onboardingCompleted) {
        const reasons = protection.reasons
          .map((r) => (r === 'no_owner_channels' ? 'нет каналов владельца' : 'дисциплина РОПа не выбрана'))
          .join(', ');
        signals.push({
          id: `unprotected:${company.id}`,
          stage: reasons,
          text: `🔴 <b>${esc(company.name)}</b>${tag}: петля не защищена (${esc(reasons)})`,
        });
      }

      // Очередь на разбор. До 09.08.2026 свод её не видел вовсе: он следил за тишиной, защитой
      // петли и доступами, а накопленный долг ревью — то есть ровно ту смерть петли, ради
      // которой весь этот сторож и написан (урок одного клиента в шапке файла) — не показывал. На
      // проде в этот момент висело 36 неразобранных записей, и свод писал «строк 2».
      // Считаем ТЕМ ЖЕ способом, что и сам норматив: рабочие часы от МОМЕНТА СДАЧИ (правка
      // 10.08.2026 перевела норматив на businessHoursBetween и submittedAt, а свод остался на
      // календарных днях от createdAt — две модели одной величины). Из-за этого в воскресенье
      // 23.08.2026 свод писал одного клиента «самая старая 2 дня (норматив 24 ч)» про записи,
      // сданные в четверг вечером: рабочих часов там набежало девять из двадцати четырёх,
      // просрочки не было вовсе, а строка читалась как провал дисциплины РОПа.
      const pending = await this.entryRepo.find({
        where: { companyId: company.id, status: EntryStatus.SUBMITTED },
        order: { submittedAt: 'ASC' },
        take: 1,
      });
      if (pending.length) {
        const pendingCount = await this.entryRepo.count({
          where: { companyId: company.id, status: EntryStatus.SUBMITTED },
        });
        const oldestFrom = pending[0].submittedAt ?? pending[0].createdAt;
        const oldestHours = Math.floor(businessHoursBetween(company.timezone, oldestFrom, new Date(asOf)));
        const maxHours = company.reviewNorms?.maxHoursToRespond ?? DEFAULT_REVIEW_NORMS.maxHoursToRespond;
        // Строку даёт либо реальная просрочка норматива, либо накопившаяся очередь: пять
        // ждущих записей это повод посмотреть, даже когда каждая ещё внутри срока.
        if (oldestHours >= maxHours || pendingCount >= 5) {
          signals.push({
            id: `queue:${company.id}`,
            // Две ступени: очередь копится в пределах норматива и очередь его просрочила.
            // Переход между ними это новость, рост числа записей внутри ступени — нет.
            stage: oldestHours >= maxHours ? `overdue:${Math.floor(oldestHours / maxHours)}` : 'growing',
            text:
              `📝 <b>${esc(company.name)}</b>${tag}: ${pendingCount} ` +
              `${pluralRu(pendingCount, 'запись ждёт', 'записи ждут', 'записей ждут')} разбора, ` +
              `самая старая ${oldestHours} ${pluralRu(oldestHours, 'рабочий час', 'рабочих часа', 'рабочих часов')} ` +
              `из ${maxHours}`,
          });
        }
      }

      // Тишина. Раньше считалась ТОЛЬКО от последней записи, поэтому компания, где записей не
      // было НИКОГДА, не давала строки вообще: чем хуже дела, тем тише свод (правка 05.08.2026).
      // Теперь при нуле записей отсчёт идёт от старта работы, и такая компания стоит в своде
      // КАЖДЫЙ день, а не раз в неделю: «не начали» это не тишина, это несостоявшийся запуск.
      // Черновик не считается работой: запись, которую менеджер завёл и не отправил, до РОПа
      // не доехала. Раньше фильтра здесь не было, и три брошенных черновика клиента маскировали
      // тишину — «последняя запись» обновлялась, отсчёт не начинался (правка 09.08.2026).
      const last = await this.entryRepo.findOne({
        where: { companyId: company.id, status: Not(EntryStatus.DRAFT) },
        order: { createdAt: 'DESC' },
      });
      if (last) {
        // Считаем РАБОЧИЕ дни клиента, а не календарные: в выходные люди не работают, и
        // требовать от них записей в субботу значит врать в собственном своде (директива
        // решения владельца продукта 23.08.2026). Из счёта вычитается и окно приостановки за неоплату: пока
        // платформа закрыта нами, простой создаём мы, а не клиент.
        const daysQuiet = idleWorkingDays(company.timezone, last.createdAt, new Date(asOf), holdWindow);
        // Раньше строка показывалась, только когда число дней КРАТНО семи: пропущенный день
        // (деплой в 9:00, рестарт контейнера) прятал компанию ещё на неделю, а «проскочившая»
        // тишина выглядела как её отсутствие. Теперь строка держится КАЖДЫЙ день, пока молчание
        // не кончилось, — ровно как строка о невостребованном доступе двумя блоками ниже.
        if (daysQuiet >= LoopGuardScheduler.QUIET_WORKDAYS) {
          signals.push({
            id: `quiet:${company.id}`,
            // Ступень это рабочая неделя молчания: каждая новая неделя — новость и повод
            // вмешаться, каждый следующий день внутри недели — нет.
            stage: `w${Math.floor(daysQuiet / LoopGuardScheduler.QUIET_WORKDAYS)}`,
            text:
              `🌑 <b>${esc(company.name)}</b>${tag}: ${daysQuiet} ` +
              `${pluralRu(daysQuiet, 'рабочий день', 'рабочих дня', 'рабочих дней')} без новых записей`,
          });
        }
      } else {
        const startedAt = company.launchedAt ?? company.workStartedAt ?? company.createdAt;
        const daysSinceStart = idleWorkingDays(company.timezone, startedAt, new Date(asOf), holdWindow);
        if (daysSinceStart >= LoopGuardScheduler.QUIET_WORKDAYS) {
          signals.push({
            id: `nostart:${company.id}`,
            stage: `w${Math.floor(daysSinceStart / LoopGuardScheduler.QUIET_WORKDAYS)}`,
            text:
              `⛔ <b>${esc(company.name)}</b>${tag}: ${daysSinceStart} ` +
              `${pluralRu(daysSinceStart, 'рабочий день', 'рабочих дня', 'рабочих дней')} с начала работы, ` +
              `ни одной записи за всё время`,
          });
        }
      }

      // Выданный доступ, которым не воспользовались. Держим строку в своде, пока висит:
      // точечный сигнал уходит один раз (см. AccessWatchScheduler), а здесь это остаётся
      // видимым каждый день, потому что незакрытое подключение и есть остановка работы.
      const neverLogged = await this.userRepo.find({
        where: { companyId: company.id, isActive: true, lastLoginAt: IsNull() },
      });
      // Порог и счёт в РАБОЧИХ днях, как в точечном стороже доступов (AccessWatchScheduler):
      // иначе выданный в пятницу доступ попадал в свод утром воскресенья за то, что человек
      // не вошёл в выходные, и две поверхности про одно и то же говорили разными числами.
      const stale = neverLogged.filter(
        (u) =>
          TEAM_ROLES.includes(u.role) &&
          workingDaysSince(company.timezone, u.createdAt) >= LoopGuardScheduler.ACCESS_WORKDAYS,
      );
      if (stale.length) {
        const names = stale
          .map((u) => `${u.fullName} (${workingDaysSince(company.timezone, u.createdAt)} раб. дн)`)
          .join(', ');
        signals.push({
          id: `access:${company.id}`,
          // Ступень это состав людей: появился ещё один не вошедший — новость.
          stage: stale.map((u) => u.id).sort().join(','),
          text: `🔑 <b>${esc(company.name)}</b>${tag}: доступ выдан, входа нет: ${esc(names)}`,
        });
      }

      // РОПы без личной привязки Telegram (дайджест до них не доходит).
      //
      // Считается на КАЖДОМ прогоне, хотя раньше строка поднималась только по понедельникам.
      // Причина смены: условие, которое вычисляется через раз, при дедупликации начинает
      // МИГАТЬ — во вторник сигнал исчезает из картины и читается как «снято», в понедельник
      // появляется снова как новый, и вместо одного сообщения в неделю выходит два. Ритм
      // напоминаний теперь держит StaffNotifierService (раз в две недели), а сторож обязан
      // отдавать ему ПОЛНУЮ картину на каждом прогоне.
      const reviewers = await this.userRepo.find({
        where: { companyId: company.id, role: UserRole.REVIEWER, isActive: true },
      });
      for (const rop of reviewers) {
        const contact = await this.telegram.findContactByUserId(rop.id);
        // Тег обязателен и здесь: без него строка читается как претензия к работающему
        // клиенту, хотя у компании на паузе или с закрытым доступом действовать по ней
        // некому и незачем (13.08.2026, единственная строка свода, оставшаяся без пометки).
        if (!contact) {
          signals.push({
            id: `noTg:${rop.id}`,
            text: `✉️ <b>${esc(company.name)}</b>${tag}: РОП ${esc(rop.fullName)} не подключил Telegram-напоминания`,
          });
        }
      }
    }

    // Свод уходил ВСЕГДА, даже когда сказать нечего: так с 05.08.2026 доказывалась жизнь
    // крона («молчащий сторож неотличим от довольного»). Доказательство верное, носитель
    // неверный — владелец получал «Все петли защищены» каждое утро и справедливо потребовал
    // это прекратить (03.09.2026). Живость теперь доказывает отметка о прогоне, видимая в
    // админке и стерегомая WatchdogLivenessScheduler, а в Telegram уходит только новость.
    const result = await this.notifier.report('loop-health', '🩺 <b>Здоровье петель</b>', signals, {
      footer: `Проверено компаний: ${checked}`,
      force,
      emptyText: 'Все петли защищены, тишины нет, незакрытых подключений нет.',
    });
    this.logger.log(
      `[superadmin-health] открыто=${result.open}, новых=${result.fresh}, изменилось=${result.changed}, ` +
        `напомнили=${result.repeated}, снято=${result.closed}, промолчали=${result.silent}, отправлено=${result.sent}`,
    );
    return result.sent;
  }
}
