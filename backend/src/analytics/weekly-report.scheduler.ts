import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { Company, DEFAULT_REVIEW_NORMS } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { TEAM_ROLES, UserRole } from '../users/enums/user-role.enum';
import { TelegramService, escapeTelegramHtml as escapeHtml } from './telegram.service';
import { RopBonusService } from '../rop-bonus/rop-bonus.service';
import { AnalyticsService } from './analytics.service';
import { sendReportEmail } from './mailer';
import { localParts, startOfWeekMoment, rampUpWeek, scaleThreshold, activeDaysCount, businessHoursBetween } from '../common/company-time.util';
import { GamificationService } from '../gamification/gamification.service';
import { Zone, calcZone } from '../common/zone.util';
import { CompanyEventsService } from '../company-events/company-events.service';
import { isUnderOurWatch } from '../companies/signal-audience.util';
import { emailColor } from '../mail/design-tokens';
import { StaffNotifierService } from './staff-notifier.service';

/**
 * Еженедельный accountability-report собственнику компании.
 * Понедельник 09:00 — собирает данные за прошлую ISO-неделю и шлёт в выбранные каналы:
 *   - email (HTML) на reportChannels.weeklyAccountability.emails
 *   - Telegram (plain text) на reportChannels.weeklyAccountability.telegramChatIds
 * Если оба списка пустые — не шлёт ничего (канал не настроен).
 */
@Injectable()
export class WeeklyReportScheduler {
  private readonly logger = new Logger(WeeklyReportScheduler.name);

  constructor(
    @InjectRepository(Entry)
    private readonly entryRepo: Repository<Entry>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly ropBonus: RopBonusService,
    private readonly analyticsService: AnalyticsService,
    private readonly gamification: GamificationService,
    private readonly events: CompanyEventsService,
    private readonly notifier: StaffNotifierService,
  ) {}

  // Ежечасно: отчёт уходит в понедельник 09:00 ЛОКАЛЬНОГО времени компании
  // (Камчатка получает утром своего понедельника, а не в 21:00). Российские зоны
  // целочасовые и без летнего времени — сработает ровно один раз в неделю.
  @Cron('0 * * * *', { name: 'weekly-accountability-report' })
  async handleWeekly(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      // Закрытым и демонстрационным отчёт не нужен: работа там закончилась или её не было.
      // Пауза приглушает то, что идёт КОМАНДЕ клиента; строку о самой паузе шлёт отдельная
      // ветка ниже (см. processCompany), поэтому здесь достаточно архива и песочницы.
      if (!isUnderOurWatch(company)) continue;
      const lp = localParts(company.timezone);
      if (lp.isoWeekday !== 1 || lp.hour !== 9) continue;
      try {
        await this.processCompany(company, { awardGamification: true });
      } catch (err) {
        this.logger.error(`weekly for ${company.name}: ${(err as Error).message}`);
      }
    }
    // Отметка о прогоне: доказательство, что расписание живо. Ставится на КАЖДОМ часовом
    // обходе, а не только в понедельник, иначе неделя без активных клиентов читалась бы
    // сторожем сторожей как смерть крона.
    await this.notifier.markRun('weekly-report', companies.length, false);
  }

  // «Прошлая неделя» — по таймзоне компании: в понедельник Камчатки сервер ещё
  // живёт в воскресенье, и серверный расчёт брал бы не ту неделю
  private getPreviousWeekRange(tz?: string | null): { from: Date; to: Date } {
    const monThisWeek = startOfWeekMoment(tz);
    const monPrevWeek = new Date(monThisWeek.getTime() - 7 * 86_400_000);
    return { from: monPrevWeek, to: monThisWeek };
  }

  /**
   * Блок «работа стоит» для недели с нулём записей: вывод вместо сухой сводки.
   *
   * Возвращает null, если записи за неделю были (обычный отчёт не трогаем). Иначе даёт две
   * строки: сколько дней простоя и кто именно не работает, поимённо. Имена важнее процентов:
   * «Вячеслав ни разу не входил» рождает действие, «загружено 0 записей» не рождает ничего.
   */
  private async buildIdleBlock(
    company: Company,
    weekEntriesCount: number,
  ): Promise<{ verdict: string; detail: string } | null> {
    if (weekEntriesCount > 0) return null;

    const last = await this.entryRepo.findOne({
      where: { companyId: company.id },
      order: { createdAt: 'DESC' },
    });
    const since = last
      ? new Date(last.createdAt)
      : new Date(company.launchedAt ?? company.workStartedAt ?? company.createdAt);
    const days = Math.max(0, Math.floor((Date.now() - since.getTime()) / 86_400_000));
    // Работа возобновилась на этой неделе: за прошлую записей нет, но люди уже сдают. Блок
    // простоя тут врал бы («работа стоит 0 дней»), поэтому уходит обычный отчёт с честным
    // нулём за прошлую неделю. Поймано прогоном на живых данных клиента 05.08.2026, где команда
    // вышла в работу накануне.
    if (last && days < 3) return null;
    const verdict = last
      ? `За эту неделю ни одной записи. Работа стоит ${days} ${pluralRu(days, 'день', 'дня', 'дней')}, ` +
        `последняя запись была ${since.toLocaleDateString('ru-RU')}.`
      : `За эту неделю ни одной записи. С начала работы прошло ${days} ` +
        `${pluralRu(days, 'день', 'дня', 'дней')}, команда не сдала ещё ни одной.`;

    const team = await this.userRepo.find({ where: { companyId: company.id, isActive: true } });
    const never = team.filter((u) => TEAM_ROLES.includes(u.role) && !u.lastLoginAt);
    const parts: string[] = [];
    if (never.length) {
      parts.push(`Ни разу не входили: ${never.map((u) => u.fullName).join(', ')}.`);
    }
    const rops = team.filter((u) => u.role === UserRole.REVIEWER && u.lastLoginAt);
    for (const rop of rops) {
      parts.push(
        `${rop.fullName} (РОП) последний раз заходил ${new Date(rop.lastLoginAt as Date).toLocaleDateString('ru-RU')}.`,
      );
    }
    parts.push(
      never.length
        ? 'Это не сбой платформы, доступы работают. Чаще всего доступ просто не дошёл до человека, мы можем отправить его в рабочий чат заново.'
        : 'Это не сбой платформы. Спросите руководителя отдела продаж, что мешает команде, либо ответьте на это письмо, и подключится ваш трекер.',
    );
    return { verdict, detail: parts.join(' ') };
  }

  // Недельная зона по менеджеру (GAM13/GAM1/REG9): считаем ровно так же, как в
  // sprints.service (calcZone по звонкам/чатам с порогами компании), но по факту
  // закрытой недели [from, to), а не по текущему спринту. 'below' не награждается —
  // XpReason знает только WEEKLY_GOOD_ZONE/WEEKLY_GREAT_ZONE.
  private async awardWeeklyZones(company: Company, from: Date, to: Date): Promise<void> {
    const weekEntries = await this.entryRepo.find({
      where: { companyId: company.id },
      select: ['id', 'managerId', 'type', 'createdAt', 'status'],
    });
    // В зону идёт только отправленная/отревьюенная работа — ровно как в dashboard/getTeamProgress
    // (определение KPI менеджера). Черновики РОПу не сданы: XP за зону по ним = награда за имитацию.
    const inWeek = weekEntries.filter((e) => {
      if (e.status !== 'submitted' && e.status !== 'reviewed') return false;
      const ms = new Date(e.createdAt).getTime();
      return ms >= from.getTime() && ms < to.getTime();
    });
    if (inWeek.length === 0) return;

    const byManager = new Map<string, { calls: number; chats: number }>();
    for (const e of inWeek) {
      if (!byManager.has(e.managerId)) byManager.set(e.managerId, { calls: 0, chats: 0 });
      const m = byManager.get(e.managerId)!;
      if (e.type === 'call') m.calls++;
      else if (e.type === 'chat') m.chats++;
    }

    // Разгонная неделя (запуск не с понедельника): начисляем зону по урезанным порогам, иначе
    // короткая первая неделя лишила бы команду XP за зону не по их вине.
    const { factor } = rampUpWeek(company, from);
    const thresholdGoodCalls = scaleThreshold(company.thresholdGoodCalls ?? 5, factor);
    const thresholdGoodChats = scaleThreshold(company.thresholdGoodChats ?? 5, factor);
    const thresholdGreatCalls = scaleThreshold(company.thresholdGreatCalls ?? 8, factor);
    const thresholdGreatChats = scaleThreshold(company.thresholdGreatChats ?? 8, factor);

    for (const [managerId, counts] of byManager.entries()) {
      const callZone = company.callsEnabled ? calcZone(counts.calls, thresholdGoodCalls, thresholdGreatCalls) : null;
      const chatZone = company.chatsEnabled ? calcZone(counts.chats, thresholdGoodChats, thresholdGreatChats) : null;
      const zones = [callZone, chatZone].filter((z): z is Zone => z !== null);
      if (zones.length === 0) continue;
      const overall: Zone = zones.includes('below') ? 'below' : zones.includes('good') ? 'good' : 'great';
      if (overall === 'below') continue;
      await this.gamification.awardWeeklyZoneOnce(managerId, overall, company.id, from, to);
    }
  }

  // public: используется также admin-endpoint'ом «отправить тестовый отчёт».
  // awardGamification=true ТОЛЬКО из реального крона (handleWeekly) — тестовая кнопка
  // в админке не должна начислять XP за недельную зону.
  // Возвращает false, если каналы не настроены (SCHED1: раньше endpoint отвечал {sent:true}
  // даже когда физически некуда было слать — суперадмин думал, что рассылка работает).
  /**
   * Недельная строка о паузе вместо отчёта. Молчать нельзя: пауза, о которой перестали
   * напоминать, и есть механизм трёхмесячного исчезновения клиента.
   */
  private async sendPauseNote(company: Company, tgChats: string[]): Promise<boolean> {
    const info = company.pauseInfo ?? {};
    const returnAt = info.expectedReturnAt ? new Date(info.expectedReturnAt) : null;
    const text =
      `⏸ <b>${escapeHtml(company.name)}</b>: работа над ошибками на паузе.\n` +
      (info.reason ? `Причина: ${escapeHtml(info.reason)}.\n` : '') +
      (returnAt ? `Возобновляем ${returnAt.toLocaleDateString('ru-RU')}.` : 'Дата возобновления не назначена: напишите нам, и назначим.') +
      (info.conditionToEnd ? `\nУсловие возврата: ${escapeHtml(info.conditionToEnd)}.` : '');
    const sent = tgChats.length ? await this.telegram.sendToMany(tgChats, text) : 0;
    await this.events.logDelivery(company.id, 'telegram_owner', sent > 0, 'недельная строка о паузе');
    return sent > 0;
  }

  async processCompany(company: Company, opts: { awardGamification?: boolean } = {}): Promise<boolean> {
    const { from, to } = this.getPreviousWeekRange(company.timezone);

    if (opts.awardGamification) {
      await this.awardWeeklyZones(company, from, to).catch((err) =>
        this.logger.error(`weekly-zones ${company.name}: ${(err as Error).message}`),
      );
    }

    const emails = company.reportChannels?.weeklyAccountability?.emails ?? [];
    const tgChats = company.reportChannels?.weeklyAccountability?.telegramChatIds ?? [];
    if (emails.length === 0 && tgChats.length === 0) {
      return false;
    }

    // Компания на паузе: разбор недели с нулями владельцу не нужен — работу остановили по
    // договорённости, и «загружено 0 записей» звучит как претензия к нему же. Вместо отчёта
    // одна строка: пауза идёт, вот до какого числа. Пауза приглушает тревоги, а не связь.
    if (company.status === 'paused') {
      return this.sendPauseNote(company, tgChats);
    }

    // Доступ закрыт нами за неоплату: отчёт «загружено 0 записей, работа стоит N дней» звучал
    // бы как претензия к собственнику за то, что сделали мы сами. Разговор о деньгах ведёт
    // владелец лично, а не еженедельная рассылка; себе состояние видим в своде здоровья петель.
    if (company.paymentHold) {
      this.logger.log(`[weekly] ${company.name}: отчёт не отправлен, доступ закрыт за неоплату`);
      return false;
    }
    const norms = company.reviewNorms ?? DEFAULT_REVIEW_NORMS;

    // Все записи компании за прошлую неделю (по createdAt)
    const weekEntries = await this.entryRepo
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.manager', 'manager')
      .leftJoinAndSelect('entry.reviewer', 'reviewer')
      .where('entry.companyId = :companyId', { companyId: company.id })
      .andWhere('entry.createdAt >= :from', { from })
      .andWhere('entry.createdAt < :to', { to })
      .andWhere('entry.deletedAt IS NULL')
      .getMany();

    // Группировка по менеджеру
    const managerStats = new Map<string, { name: string; count: number; selfReviewLens: number[]; days: Date[] }>();
    for (const e of weekEntries) {
      const mid = e.managerId;
      if (!managerStats.has(mid)) {
        managerStats.set(mid, { name: e.manager?.fullName ?? '—', count: 0, selfReviewLens: [], days: [] });
      }
      const m = managerStats.get(mid)!;
      m.count++;
      m.days.push(e.createdAt);
      const len = (e.selfReviewCorrect?.length ?? 0)
        + (e.selfReviewImprove?.length ?? 0)
        + (e.selfReviewSuggestions?.length ?? 0);
      if (len > 0) m.selfReviewLens.push(len);
    }

    // Группировка по reviewer (РОПу) — только те записи, где reviewedAt на этой неделе
    const reviewerStats = new Map<string, { name: string; count: number; reviewChars: number[]; deltas: number[]; days: Date[] }>();
    for (const e of weekEntries) {
      if (!e.reviewerId || !e.reviewedAt) continue;
      // проверяем, что reviewedAt попадает в диапазон недели
      const rMs = new Date(e.reviewedAt).getTime();
      if (rMs < from.getTime() || rMs >= to.getTime()) continue;
      const rid = e.reviewerId;
      if (!reviewerStats.has(rid)) {
        reviewerStats.set(rid, { name: e.reviewer?.fullName ?? '—', count: 0, reviewChars: [], deltas: [], days: [] });
      }
      const r = reviewerStats.get(rid)!;
      r.count++;
      r.days.push(new Date(e.reviewedAt));
      r.reviewChars.push(e.reviewText?.length ?? 0);
      const submittedMs = new Date(e.createdAt).getTime();
      if (rMs > submittedMs) r.deltas.push((rMs - submittedMs) / (1000 * 60 * 60));
    }

    // Записи прошлой недели — для дельты в вердикте
    const prevFrom = new Date(from); prevFrom.setDate(prevFrom.getDate() - 7);
    const prevWeekCount = await this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId: company.id })
      .andWhere('entry.createdAt >= :prevFrom', { prevFrom })
      .andWhere('entry.createdAt < :from', { from })
      .andWhere('entry.deletedAt IS NULL')
      .getCount()
      .catch(() => 0);

    // Просроченные — submitted, ждущие дольше maxHoursToRespond часов. Свежая очередь — отдельно,
    // чтобы не красить нормальную работу как проблему.
    const overdueThreshold = new Date(Date.now() - norms.maxHoursToRespond * 3600 * 1000);
    const queueNow = await this.entryRepo.count({
      where: { companyId: company.id, status: EntryStatus.SUBMITTED },
    }).catch(() => 0);
    // Норматив считается в РАБОЧИХ часах от момента сдачи записи: запрос отбирает кандидатов
    // по календарю, а решение принимает рабочее время компании. Иначе в отчёт собственнику
    // попадают выходные, и руководитель выглядит нарушителем, ответив в первое рабочее утро.
    const overdueNow = (
      await this.entryRepo
        .createQueryBuilder('entry')
        .where('entry.companyId = :companyId', { companyId: company.id })
        .andWhere('entry.status = :status', { status: EntryStatus.SUBMITTED })
        .andWhere('COALESCE(entry.submittedAt, entry.createdAt) <= :threshold', { threshold: overdueThreshold })
        .andWhere('entry.deletedAt IS NULL')
        .select(['entry.id', 'entry.createdAt', 'entry.submittedAt'])
        .getMany()
        .catch(() => [])
    ).filter(e => businessHoursBetween(company.timezone, e.submittedAt ?? e.createdAt) > norms.maxHoursToRespond)
      .length;

    // Форматирование
    const managersText: string[] = [];
    const managersHtml: string[] = [];
    for (const m of managerStats.values()) {
      // Ритм важнее объёма: те же записи, сданные одним вечером, навык не развивают.
      const days = activeDaysCount(company.timezone, m.days);
      const daysText = `${days} ${pluralRu(days, 'день', 'дня', 'дней')} из 4`;
      managersText.push(`• ${escapeHtml(m.name)}: ${m.count} ${pluralRu(m.count, 'запись', 'записи', 'записей')} за ${daysText}, самоанализ заполнен у ${m.selfReviewLens.length} из ${m.count}`);
      managersHtml.push(`<tr><td>${escapeHtml(m.name)}</td><td>${m.count} (${daysText})</td><td>${m.selfReviewLens.length} из ${m.count}</td></tr>`);
    }

    const reviewersText: string[] = [];
    const reviewersHtml: string[] = [];
    for (const r of reviewerStats.values()) {
      const avgChars = r.reviewChars.length
        ? Math.round(r.reviewChars.reduce((a, b) => a + b, 0) / r.reviewChars.length)
        : 0;
      const sortedDeltas = [...r.deltas].sort((a, b) => a - b);
      const median = sortedDeltas.length
        ? Math.round(sortedDeltas[Math.floor(sortedDeltas.length / 2)] * 10) / 10
        : 0;
      const medianText = r.deltas.length ? `${String(median).replace('.', ',')} ч` : '—';
      const lenText = `${avgChars} симв. (норма от ${norms.minReviewCharsAvg})`;
      if (norms.minReviewsPerWeek > 0) {
        const normIcon = r.count >= norms.minReviewsPerWeek ? '🟢 в норме' : r.count >= norms.minReviewsPerWeek * 0.5 ? '🟡 внимание' : '🔴 отставание';
        const rDays = activeDaysCount(company.timezone, r.days);
        reviewersText.push(`• ${escapeHtml(r.name)}: ${r.count} из ${norms.minReviewsPerWeek} ревью (${normIcon}), разбирал ${rDays} ${pluralRu(rDays, 'день', 'дня', 'дней')} из 5, скорость ответа ${medianText}, длина ${lenText}`);
        reviewersHtml.push(`<tr><td>${escapeHtml(r.name)} · ${normIcon}</td><td>${r.count} из ${norms.minReviewsPerWeek}</td><td>${medianText}</td><td>${lenText}</td></tr>`);
      } else {
        reviewersText.push(`• ${escapeHtml(r.name)}: ${r.count} ревью (норматив не задан: задайте в настройках, и появится светофор), скорость ответа ${medianText}`);
        reviewersHtml.push(`<tr><td>${escapeHtml(r.name)}</td><td>${r.count}</td><td>${medianText}</td><td>${lenText}</td></tr>`);
      }
    }

    // Контур признания РОПа: серия недель «все нормативы в зелёной зоне».
    // Видимость стабильности перед собственником мотивирует РОПа сильнее значков.
    const streakLinesText: string[] = [];
    const streakLinesHtml: string[] = [];
    for (const [rid, r] of reviewerStats.entries()) {
      try {
        const streak = await this.analyticsService.getReviewerWeeklyStreak(company.id, rid);
        if (streak.hasNorm && streak.currentStreak >= 3) {
          const w = streak.currentStreak;
          const weeksWord = pluralRu(w, 'неделю', 'недели', 'недель');
          streakLinesText.push(`🏆 ${escapeHtml(r.name)} держит все нормативы ${w} ${weeksWord} подряд. Отметьте это при случае.`);
          streakLinesHtml.push(`<p class="streak">🏆 <b>${escapeHtml(r.name)}</b> держит все нормативы <b>${w} ${weeksWord} подряд</b>. Отметьте это при случае.</p>`);
        }
      } catch { /* признание не должно ломать отчёт */ }
    }

    // Серия регулярности команды: сколько недель подряд спринт закрывается полным
    // составом. Прямая метрика привычки — то, ради чего и идёт блок «Работа над ошибками».
    try {
      const teamStreak = await this.analyticsService.getCompanyTeamStreak(company.id, company);
      if (teamStreak.hasTeam && teamStreak.currentStreak >= 2) {
        const w = teamStreak.currentStreak;
        const weeksWord = pluralRu(w, 'неделю', 'недели', 'недель');
        streakLinesText.push(`📈 Команда закрывает спринт полным составом ${w} ${weeksWord} подряд.`);
        streakLinesHtml.push(`<p class="streak">📈 <b>Команда</b> закрывает спринт полным составом <b>${w} ${weeksWord} подряд</b>.</p>`);
      }
    } catch { /* признание не должно ломать отчёт */ }

    // «02.06–08.06.2026»: короткое тире, год один раз
    const endDate = new Date(to.getTime() - 24 * 3600 * 1000);
    const dd = (d: Date) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    const dateFrom = dd(from);
    const dateTo = `${dd(endDate)}.${endDate.getFullYear()}`;

    // Премия РОПа — прогноз текущего месяца (если включена)
    let bonusTgBlock = '';
    let bonusHtmlBlock = '';
    if (company.ropBonus?.enabled) {
      try {
        const b = await this.ropBonus.getMonthStats(company.id, undefined, company);
        const pctText = b.onTimePct === null ? 'пока нет данных' : `${b.onTimePct}% ревью в срок`;
        const payoutNote = company.ropBonus.payoutDay
          ? ` Выплата ${company.ropBonus.payoutDay}-го числа.`
          : '';
        const upside = b.pendingCount > 0 && b.bestCaseAmount > b.currentAmount
          ? ` Если ${b.pendingCount} ${pluralRu(b.pendingCount, 'ожидающая запись получит', 'ожидающие записи получат', 'ожидающих записей получат')} ревью в срок: ${b.bestCasePct}% и ${b.bestCaseAmount.toLocaleString('ru-RU')} ₽.`
          : (b.pendingCount > 0 ? ` Ожидают ревью: ${b.pendingCount}.` : '');
        bonusTgBlock =
          `💰 <b>Премия РОПа (прогноз месяца):</b> ${pctText} → ${b.currentAmount.toLocaleString('ru-RU')} ₽.` +
          upside + `${payoutNote}\n\n`;
        bonusHtmlBlock =
          `<h2>Премия РОПа: прогноз месяца</h2>` +
          `<p style="font-size:15px;margin:4px 0 0 0"><b>${escapeHtml(pctText)}</b> → ` +
          `<b>${b.currentAmount.toLocaleString('ru-RU')} ₽</b>` +
          (b.pendingCount > 0 && b.bestCaseAmount > b.currentAmount
            ? ` · если ${b.pendingCount} ожидающих выйдут в срок: ${b.bestCasePct}% и ${b.bestCaseAmount.toLocaleString('ru-RU')} ₽`
            : (b.pendingCount > 0 ? ` · ожидают ревью: ${b.pendingCount}` : '')) +
          `${payoutNote ? ` · ${escapeHtml(payoutNote.trim())}` : ''}</p>`;
      } catch { /* премия не должна ломать отчёт */ }
    }

    // Вердикт недели одной строкой: вывод раньше таблиц
    const totalReviewsWeek = Array.from(reviewerStats.values()).reduce((s, r) => s + r.count, 0);

    // Неделя с нулём записей это не «сводка, где мало цифр», а главная новость (правка
    // 05.08.2026). Отчёт клиента уходил владельцу каждый понедельник и говорил «загружено 0
    // записей»: формально правда, но человек, который заходит раз в месяц, читает это как
    // «ничего не произошло», а не как «работа стоит». Здесь при нуле вердикт называет простой
    // числом дней, перечисляет тех, кто ни разу не входил, и заканчивается одним действием.
    const idleBlock = await this.buildIdleBlock(company, weekEntries.length);
    const verdict = idleBlock
      ? idleBlock.verdict
      : `За неделю ${dateFrom}–${dateTo}: команда загрузила ${weekEntries.length} ` +
        `${pluralRu(weekEntries.length, 'запись', 'записи', 'записей')}` +
        (prevWeekCount > 0 || weekEntries.length > 0 ? ` (на прошлой неделе ${prevWeekCount})` : '') +
        `, РОП написал ${totalReviewsWeek} ревью.`;

    // Telegram text (plain)
    const tgText =
      `📊 <b>${escapeHtml(company.name)}</b>: Работа над ошибками\n` +
      `${escapeHtml(verdict)}\n` +
      (idleBlock ? `\n${escapeHtml(idleBlock.detail)}\n` : '') +
      `\n` +
      `<b>Менеджеры:</b>\n${managersText.join('\n') || '• нет записей'}\n\n` +
      `<b>РОПы:</b>\n${reviewersText.join('\n') || '• нет ревью'}\n` +
      (streakLinesText.length ? streakLinesText.join('\n') + '\n\n' : '\n') +
      bonusTgBlock +
      (overdueNow > 0
        ? `⚠ ${overdueNow} ${pluralRu(overdueNow, 'запись ждёт', 'записи ждут', 'записей ждут')} ревью дольше нормы ${norms.maxHoursToRespond} ч. Напомните РОПу`
        : queueNow > 0
          ? `В очереди на ревью: ${queueNow} ${pluralRu(queueNow, 'запись', 'записи', 'записей')} (в пределах нормы)`
          : '').trimEnd();

    // Email HTML
    const html = `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"/><title>Работа над ошибками: ${escapeHtml(company.name)}</title>
<style>
body{font-family:-apple-system,'Source Sans 3',sans-serif;background:${emailColor('color-canvas')};padding:24px;color:${emailColor('color-fg')};}
.container{max-width:720px;margin:0 auto;background:${emailColor('color-surface')};border-radius:16px;border:1px solid ${emailColor('color-border')};overflow:hidden}
.header{background:${emailColor('color-accent')};color:${emailColor('color-on-inverse')};padding:24px 32px}
h1{font-size:22px;margin:0 0 6px 0}
.subtitle{opacity:0.85;font-size:14px}
.content{padding:24px 32px}
h2{font-size:13px;color:${emailColor('color-fg-subtle')};letter-spacing:0.02em;margin:24px 0 8px 0;font-weight:600}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid ${emailColor('color-border')}}
th{background:${emailColor('color-canvas')};color:${emailColor('color-fg-subtle')};font-weight:600;font-size:12px}
.alert{background:${emailColor('color-danger-subtle')};border:1px solid ${emailColor('color-danger-border')};color:${emailColor('color-danger-fg')};padding:10px 14px;border-radius:8px;font-size:14px;margin-top:16px}
.footer{padding:16px 32px;background:${emailColor('color-canvas')};border-top:1px solid ${emailColor('color-border')};color:${emailColor('color-fg-disabled')};font-size:12px}
</style></head>
<body><div class="container">
<div class="header">
<h1>Работа над ошибками: ${escapeHtml(company.name)}</h1>
<div class="subtitle">Отчёт за неделю ${dateFrom}–${dateTo}</div>
</div>
<div class="content">
<p style="font-size:16px;margin:0 0 8px 0"><b>${escapeHtml(verdict)}</b></p>
${idleBlock ? `<div class="alert">${escapeHtml(idleBlock.detail)}</div>` : ''}
<p style="margin:12px 0 4px 0"><a href="${process.env.APP_URL || 'https://app.example.invalid'}/analytics" style="display:inline-block;background:${emailColor('color-accent')};color:${emailColor('color-on-inverse')};text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px">Открыть аналитику недели</a></p>
<h2>Менеджеры</h2>
<table>
<thead><tr><th>ФИО</th><th>Записей</th><th>Самоанализ заполнен</th></tr></thead>
<tbody>${managersHtml.join('') || `<tr><td colspan="3" style="color:${emailColor('color-fg-disabled')}">Нет записей</td></tr>`}</tbody>
</table>
<h2>Руководители отдела продаж</h2>
<table>
<thead><tr><th>ФИО</th><th>Ревью / норма</th><th>Скорость ответа</th><th>Длина ревью</th></tr></thead>
<tbody>${reviewersHtml.join('') || `<tr><td colspan="4" style="color:${emailColor('color-fg-disabled')}">Нет ревью</td></tr>`}</tbody>
</table>
${streakLinesHtml.join('')}
${bonusHtmlBlock}
${overdueNow > 0
    ? `<div class="alert">⚠ <b>${overdueNow}</b> ${pluralRu(overdueNow, 'запись ждёт', 'записи ждут', 'записей ждут')} ревью дольше нормы ${norms.maxHoursToRespond} ч. Напомните РОПу.</div>`
    : queueNow > 0
      ? `<p style="color:${emailColor('color-fg-subtle')};font-size:13px;margin-top:16px">В очереди на ревью: ${queueNow} ${pluralRu(queueNow, 'запись', 'записи', 'записей')} (в пределах нормы).</p>`
      : ''}
</div>
<div class="footer">Платформа «Работа над ошибками»: <a href="${process.env.APP_URL || 'https://app.example.invalid'}/">платформа</a></div>
</div></body></html>`;

    // Отправка Telegram (с кнопкой к аналитике)
    if (tgChats.length > 0) {
      const sent = await this.telegram.sendToMany(tgChats, tgText, { text: 'Открыть аналитику недели', url: (process.env.APP_URL || 'https://app.example.invalid') + '/analytics' });
      this.logger.log(`[weekly/${company.name}] TG sent ${sent}/${tgChats.length}`);
      // Попытка доставки и её исход попадают в журнал компании: иначе на вопрос «а отчёт
      // вообще уходил» ответить из платформы нельзя, а лог контейнера живёт до рестарта.
      await this.events.logDelivery(
        company.id,
        'telegram_owner',
        sent > 0,
        'еженедельный отчёт',
        `доставлено ${sent} из ${tgChats.length}`,
      );
    }

    // Отправка email. COMM2: транзиентный сбой SMTP (кратковременная недоступность,
    // greylisting) без повтора терял недельный отчёт безвозвратно до следующего понедельника —
    // один повтор через паузу закрывает основной случай без новой инфраструктуры очередей.
    if (emails.length > 0) {
      // Тема письма это то, что владелец видит в списке, не открывая. При нуле она обязана
      // называть новость, а не считать нули: «0 записей, 0 ревью» читается как рутина.
      const subject = idleBlock
        ? `${company.name}: разбор звонков стоит, за неделю ни одной записи`
        : `${company.name}: ${weekEntries.length} ${pluralRu(weekEntries.length, 'запись', 'записи', 'записей')}, ${totalReviewsWeek} ревью, неделя ${dateFrom}`;
      try {
        await sendReportEmail(emails, subject, html);
        this.logger.log(`[weekly/${company.name}] email sent to ${emails.length}`);
        await this.events.logDelivery(company.id, 'email_owner', true, 'еженедельный отчёт', `адресатов: ${emails.length}`);
      } catch (err) {
        this.logger.warn(`[weekly/${company.name}] email error, retrying once: ${(err as Error).message}`);
        try {
          await new Promise((r) => setTimeout(r, 2000));
          await sendReportEmail(emails, subject, html);
          this.logger.log(`[weekly/${company.name}] email sent to ${emails.length} on retry`);
          await this.events.logDelivery(company.id, 'email_owner', true, 'еженедельный отчёт', 'со второй попытки');
        } catch (err2) {
          this.logger.warn(`[weekly/${company.name}] email retry failed: ${(err2 as Error).message}`);
          await this.events.logDelivery(
            company.id,
            'email_owner',
            false,
            'еженедельный отчёт',
            (err2 as Error).message,
          );
        }
      }
    }
    return true;
  }
}

/** Русское склонение: pluralRu(3, 'запись', 'записи', 'записей') → 'записи' */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}
