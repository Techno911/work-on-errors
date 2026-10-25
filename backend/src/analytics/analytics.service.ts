import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThanOrEqual } from 'typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { EntryType } from '../entries/enums/entry-type.enum';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { Company, ReviewNormsData, DEFAULT_REVIEW_NORMS } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Zone, calcZone } from '../common/zone.util';
import { startOfWeekMoment, activeDaysCount, businessHoursBetween } from '../common/company-time.util';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Entry)
    private readonly entryRepo: Repository<Entry>,
    @InjectRepository(ErrorTag)
    private readonly tagRepo: Repository<ErrorTag>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async getErrorFrequency(companyId: string, period: string = 'all') {
    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .innerJoin('entry.errorTags', 'tag')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.status = :status', { status: EntryStatus.REVIEWED })
      .andWhere('entry.deletedAt IS NULL');

    // Один since для числителя (counts) И знаменателя (totalReviewed): иначе процент занижен
    // (месячные вхождения тега делятся на всех-времён проверенные) — до 7× искажение.
    let since: Date | null = null;
    if (period === 'month') {
      since = new Date();
      since.setMonth(since.getMonth() - 1);
    } else if (period === 'quarter') {
      since = new Date();
      since.setMonth(since.getMonth() - 3);
    }
    if (since) {
      qb.andWhere('entry.createdAt >= :since', { since });
    }

    const results = await qb
      .select('tag.id', 'tagId')
      .addSelect('tag.name', 'tagName')
      .addSelect('tag.color', 'color')
      .addSelect('COUNT(DISTINCT entry.id)', 'count')
      .groupBy('tag.id')
      .addGroupBy('tag.name')
      .addGroupBy('tag.color')
      .orderBy('count', 'DESC')
      .getRawMany();

    const totalReviewed = await this.entryRepo.count({
      where: since
        ? { companyId, status: EntryStatus.REVIEWED, createdAt: MoreThanOrEqual(since) }
        : { companyId, status: EntryStatus.REVIEWED },
    });

    const totalEntries = await this.entryRepo.count({
      where: { companyId },
    });

    return {
      period,
      totalEntries,
      totalReviewed,
      tags: results.map(r => ({
        tagId: r.tagId,
        tagName: r.tagName,
        color: r.color,
        count: parseInt(r.count as string),
        percentage: totalReviewed > 0
          ? Math.round((parseInt(r.count as string) / totalReviewed) * 1000) / 10
          : 0,
      })),
    };
  }

  async getErrorTrend(companyId: string, tagId: string) {
    const tag = await this.tagRepo.findOne({ where: { id: tagId } });

    const results = await this.entryRepo
      .createQueryBuilder('entry')
      .innerJoin('entry.errorTags', 'tag', 'tag.id = :tagId', { tagId })
      .innerJoin('entry.sprint', 'sprint')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.status = :status', { status: EntryStatus.REVIEWED })
      .andWhere('entry.deletedAt IS NULL')
      .select('sprint.id', 'sprintId')
      .addSelect('sprint.label', 'sprintLabel')
      .addSelect('sprint.startDate', 'startDate')
      .addSelect('COUNT(DISTINCT entry.id)', 'count')
      .groupBy('sprint.id')
      .addGroupBy('sprint.label')
      .addGroupBy('sprint.startDate')
      .orderBy('sprint.startDate', 'ASC')
      .getRawMany();

    const sprints = results.map(r => ({
      sprintLabel: r.sprintLabel,
      count: parseInt(r.count as string),
    }));

    // Determine trend
    let trend = 'stable';
    if (sprints.length >= 2) {
      const first = sprints[0].count;
      const last = sprints[sprints.length - 1].count;
      if (last < first) trend = 'decreasing';
      else if (last > first) trend = 'increasing';
    }

    return {
      tagName: tag?.name ?? 'Unknown',
      sprints,
      trend,
    };
  }

  async getManagerStats(companyId: string, sprintId?: string) {
    // Таймзона нужна для метрики «дней активности»: день считается по местному времени компании.
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.manager', 'manager')
      .leftJoinAndSelect('entry.errorTags', 'tag')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.deletedAt IS NULL');

    if (sprintId) {
      qb.andWhere('entry.sprintId = :sprintId', { sprintId });
    }

    const entries = await qb
      .select([
        'entry.id',
        'entry.managerId',
        'entry.status',
        'entry.createdAt',
        'entry.selfReviewCorrect',
        'entry.selfReviewImprove',
        'entry.selfReviewSuggestions',
        'entry.type',
        'manager.id',
        'manager.fullName',
        'tag.id',
        'tag.name',
        'tag.color',
      ])
      .getMany();

    // Group by manager
    const managerMap = new Map<string, {
      managerId: string;
      fullName: string;
      entries: typeof entries;
    }>();

    for (const entry of entries) {
      const mid = entry.managerId;
      if (!managerMap.has(mid)) {
        managerMap.set(mid, {
          managerId: mid,
          fullName: entry.manager?.fullName ?? 'Unknown',
          entries: [],
        });
      }
      managerMap.get(mid)!.entries.push(entry);
    }

    const MANAGER_COLORS = ['#FDA4AF', '#86EFAC', '#93C5FD', '#FCD34D', '#C4B5FD', '#6EE7B7'];
    let colorIndex = 0;

    const managers = Array.from(managerMap.values()).map(m => {
      const reviewed = m.entries.filter(e => e.status === EntryStatus.REVIEWED);

      // Count tag frequencies
      const tagCount = new Map<string, { tagName: string; count: number }>();
      for (const e of reviewed) {
        for (const t of (e.errorTags ?? [])) {
          if (!tagCount.has(t.id)) tagCount.set(t.id, { tagName: t.name, count: 0 });
          tagCount.get(t.id)!.count++;
        }
      }
      const topErrors = Array.from(tagCount.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);

      // Average self-review length — по ВСЕМ записям с текстом самоанализа (не только reviewed)
      const entriesWithSelfReview = m.entries.filter(e =>
        ((e.selfReviewCorrect?.length ?? 0) + (e.selfReviewImprove?.length ?? 0) + (e.selfReviewSuggestions?.length ?? 0)) > 0,
      );
      const avgLen = entriesWithSelfReview.length > 0
        ? Math.round(entriesWithSelfReview.reduce((sum, e) => {
            return sum + (e.selfReviewCorrect?.length ?? 0) + (e.selfReviewImprove?.length ?? 0) + (e.selfReviewSuggestions?.length ?? 0);
          }, 0) / entriesWithSelfReview.length)
        : 0;

      const completionRate = m.entries.length > 0
        ? Math.round((reviewed.length / m.entries.length) * 100)
        : 0;

      // Ритм: в скольких разных днях менеджер работал. Тот же объём, размазанный по неделе,
      // развивает навык, а сданный одним вечером — нет.
      const activeDays = activeDaysCount(company?.timezone, m.entries.map(e => e.createdAt));

      return {
        managerId: m.managerId,
        fullName: m.fullName,
        color: MANAGER_COLORS[colorIndex++ % MANAGER_COLORS.length],
        totalEntries: m.entries.length,
        reviewed: reviewed.length,
        avgSelfReviewLength: avgLen,
        activeDays,
        topErrors,
        completionRate,
      };
    });

    return { managers };
  }

  /**
   * Начало текущей ISO-недели (понедельник 00:00) по таймзоне компании —
   * та же граница, что у спринтов, иначе метрики и доска разойдутся.
   */
  private getStartOfWeek(tz?: string | null): Date {
    return startOfWeekMoment(tz);
  }

  /**
   * Статистика работы конкретного РОПа за период:
   *   - reviewsWritten (кол-во ревью за неделю)
   *   - targetReviews (норматив компании)
   *   - avgReviewChars (средняя длина написанных РОПом ревью)
   *   - medianHoursToRespond (медиана submittedAt→reviewedAt)
   *   - qualityPct (% ревью длиной ≥ minReviewCharsAvg)
   *   - overdue: список записей со status=submitted и waiting > maxHoursToRespond часов
   *   - normStatus: 'green' | 'yellow' | 'red' | 'no-norm'
   */
  /**
   * Серия недель РОПа «все нормативы в зелёной зоне» — контур признания вместо
   * детской геймификации: профессиональная планка + личный рекорд.
   * Считается ретроспективно по тем же формулам, что и недельный светофор
   * (количество ревью, медиана ответа, % качественных); просрочки в green не входят.
   * Окно — 26 недель. Текущая незавершённая неделя серию не рвёт; если она уже
   * в норме — продлевает.
   */
  async getReviewerWeeklyStreak(
    companyId: string,
    reviewerId: string,
  ): Promise<{ currentStreak: number; bestStreak: number; hasNorm: boolean }> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    const norms = company?.reviewNorms;
    if (!norms || norms.minReviewsPerWeek <= 0) {
      return { currentStreak: 0, bestStreak: 0, hasNorm: false };
    }

    const WEEKS = 26;
    const thisWeekStart = this.getStartOfWeek(company?.timezone);
    const windowStart = new Date(thisWeekStart);
    windowStart.setDate(windowStart.getDate() - 7 * WEEKS);

    const entries = await this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.reviewerId = :reviewerId', { reviewerId })
      .andWhere('entry.reviewedAt IS NOT NULL')
      .andWhere('entry.reviewedAt >= :since', { since: windowStart })
      .andWhere('entry.deletedAt IS NULL')
      .select(['entry.reviewedAt', 'entry.createdAt', 'entry.reviewText'])
      .getMany();

    // Раскладываем по неделям: 0 = текущая, 1 = прошлая, ...
    const byWeek = new Map<number, { deltas: number[]; lens: number[] }>();
    for (const e of entries) {
      const reviewedMs = new Date(e.reviewedAt as Date).getTime();
      const weekIdx = Math.floor((thisWeekStart.getTime() - reviewedMs) / (7 * 86400_000)) + (reviewedMs >= thisWeekStart.getTime() ? 0 : 1);
      const idx = reviewedMs >= thisWeekStart.getTime() ? 0 : weekIdx;
      const bucket = byWeek.get(idx) ?? { deltas: [], lens: [] };
      const submittedMs = new Date(e.createdAt).getTime();
      if (reviewedMs > submittedMs) bucket.deltas.push((reviewedMs - submittedMs) / 3600_000);
      bucket.lens.push(e.reviewText?.length ?? 0);
      byWeek.set(idx, bucket);
    }

    const weekGreen = (idx: number): boolean => {
      const b = byWeek.get(idx);
      if (!b || b.lens.length < norms.minReviewsPerWeek) return false;
      const sorted = [...b.deltas].sort((a, x) => a - x);
      const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
      const quality = Math.round((b.lens.filter(l => l >= norms.minReviewCharsAvg).length / b.lens.length) * 100);
      return median <= norms.maxHoursToRespond && quality >= norms.qualityThresholdPct;
    };

    // Текущая серия: от последней завершённой недели назад; живая текущая неделя продлевает
    let currentStreak = 0;
    for (let i = 1; i <= WEEKS; i++) {
      if (weekGreen(i)) currentStreak++;
      else break;
    }
    if (weekGreen(0)) currentStreak++;

    // Личный рекорд в окне
    let bestStreak = 0;
    let run = weekGreen(0) ? 1 : 0;
    bestStreak = run;
    for (let i = 1; i <= WEEKS; i++) {
      if (weekGreen(i)) { run++; bestStreak = Math.max(bestStreak, run); }
      else run = 0;
    }

    return { currentStreak, bestStreak: Math.max(bestStreak, currentStreak), hasNorm: true };
  }

  /**
   * Серия недель, когда команда закрывала спринт полным составом — метрика
   * регулярности для трекера и DoD методички. «Зелёная неделя» = не менее 80%
   * активных в ту неделю менеджеров были в зоне ≥ good по нормативу.
   * Состав считается на дату недели (createdAt/deletedAt), а не по текущему
   * списку — иначе добавление/деактивация менеджера переоткрывала бы закрытые
   * недели. Окно 26 недель, та же граница недели, что у спринтов (понедельник
   * по серверному времени). Заморозки личных серий на метрику не влияют.
   */
  // preloadedCompany — вызывающие из цикла по компаниям (admin dashboard, schedulers) уже держат
  // Company в памяти; повторный findOne на каждую итерацию не нужен (N1/PERF1).
  async getCompanyTeamStreak(
    companyId: string,
    preloadedCompany?: Company,
  ): Promise<{ currentStreak: number; bestStreak: number; hasTeam: boolean }> {
    const company = preloadedCompany ?? await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) return { currentStreak: 0, bestStreak: 0, hasTeam: false };

    const WEEKS = 26;
    const thisWeekStart = this.getStartOfWeek(company.timezone);
    const windowStart = new Date(thisWeekStart);
    windowStart.setDate(windowStart.getDate() - 7 * WEEKS);

    // Менеджеры компании, включая удалённых в окне — для ретро-состава по дате недели.
    const managers = await this.userRepo.find({
      where: { companyId, role: UserRole.MANAGER },
      withDeleted: true,
      select: ['id', 'createdAt', 'deletedAt', 'isActive'],
    });
    if (managers.length === 0) return { currentStreak: 0, bestStreak: 0, hasTeam: false };
    const activeNow = managers.filter((m) => m.isActive && !m.deletedAt).length;

    // Записи за окно: только то, что нужно для подсчёта зоны.
    const entries = await this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.deletedAt IS NULL')
      .andWhere('entry.createdAt >= :since', { since: windowStart })
      .select(['entry.managerId', 'entry.type', 'entry.createdAt'])
      .getMany();

    // Раскладка по неделям и менеджерам: byWeek[idx] = Map<managerId, {calls, chats}>
    const byWeek = new Map<number, Map<string, { calls: number; chats: number }>>();
    for (const e of entries) {
      const createdMs = new Date(e.createdAt).getTime();
      const idx =
        createdMs >= thisWeekStart.getTime()
          ? 0
          : Math.floor((thisWeekStart.getTime() - createdMs) / (7 * 86400_000)) + 1;
      if (idx < 0 || idx > WEEKS) continue;
      const wk = byWeek.get(idx) ?? new Map<string, { calls: number; chats: number }>();
      const cur = wk.get(e.managerId) ?? { calls: 0, chats: 0 };
      if (e.type === EntryType.CALL) cur.calls++;
      else if (e.type === EntryType.CHAT) cur.chats++;
      wk.set(e.managerId, cur);
      byWeek.set(idx, wk);
    }

    const goodCalls = company.thresholdGoodCalls ?? 5;
    const goodChats = company.thresholdGoodChats ?? 5;
    const greatCalls = company.thresholdGreatCalls ?? 8;
    const greatChats = company.thresholdGreatChats ?? 8;

    const weekBounds = (idx: number): { start: Date; end: Date } => {
      const start = new Date(thisWeekStart);
      start.setDate(start.getDate() - 7 * idx);
      const end = new Date(start);
      end.setDate(end.getDate() + 7); // конец недели эксклюзивно
      return { start, end };
    };

    const weekGreen = (idx: number): boolean => {
      const { start, end } = weekBounds(idx);
      // Состав, активный В ТУ неделю: создан до конца недели и не удалён до её начала.
      const roster = managers.filter((m) => {
        const created = new Date(m.createdAt).getTime();
        if (created >= end.getTime()) return false; // ещё не в команде
        if (m.deletedAt && new Date(m.deletedAt).getTime() < start.getTime()) return false; // уже ушёл
        return true;
      });
      if (roster.length === 0) return false; // команды в ту неделю не было — неделя не зачётная
      const wk = byWeek.get(idx);
      let inGood = 0;
      for (const m of roster) {
        const cm = wk?.get(m.id) ?? { calls: 0, chats: 0 };
        const callZone = company.callsEnabled ? calcZone(cm.calls, goodCalls, greatCalls) : null;
        const chatZone = company.chatsEnabled ? calcZone(cm.chats, goodChats, greatChats) : null;
        const zones = [callZone, chatZone].filter((z): z is Zone => z !== null);
        // ≥ good, если включён хотя бы один тип записей и ни один не в зоне below
        if (zones.length > 0 && !zones.includes('below')) inGood++;
      }
      return inGood / roster.length >= 0.8;
    };

    // Текущая серия: от последней завершённой недели назад; живая неделя продлевает.
    let currentStreak = 0;
    for (let i = 1; i <= WEEKS; i++) {
      if (weekGreen(i)) currentStreak++;
      else break;
    }
    if (weekGreen(0)) currentStreak++;

    // Личный рекорд команды в окне.
    let bestStreak = 0;
    let run = 0;
    for (let i = WEEKS; i >= 0; i--) {
      if (weekGreen(i)) {
        run++;
        bestStreak = Math.max(bestStreak, run);
      } else {
        run = 0;
      }
    }

    return { currentStreak, bestStreak: Math.max(bestStreak, currentStreak), hasTeam: activeNow > 0 };
  }

  async getReviewerStats(
    companyId: string,
    reviewerId: string,
    options: { sinceDate?: Date } = {},
  ) {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    const since = options.sinceDate ?? this.getStartOfWeek(company?.timezone);
    const norms: ReviewNormsData = company?.reviewNorms ?? DEFAULT_REVIEW_NORMS;

    const reviewer = await this.userRepo.findOne({ where: { id: reviewerId, companyId } });
    const reviewerName = reviewer?.fullName ?? 'РОП';

    // Все записи за период, проверенные этим РОПом
    const reviewedEntries = await this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.reviewerId = :reviewerId', { reviewerId })
      .andWhere('entry.reviewedAt IS NOT NULL')
      .andWhere('entry.reviewedAt >= :since', { since })
      .andWhere('entry.deletedAt IS NULL')
      .getMany();

    const reviewsWritten = reviewedEntries.length;
    // Дней с разбором за неделю: у руководителя ежедневность важнее объёма, разбор по
    // горячему следу и есть норматив 24 часа. Цель 5 из 5, включая пятницу.
    const reviewDays = activeDaysCount(company?.timezone, reviewedEntries.map(e => e.reviewedAt));
    const totalChars = reviewedEntries.reduce((s, e) => s + (e.reviewText?.length ?? 0), 0);
    const avgReviewChars = reviewsWritten > 0 ? Math.round(totalChars / reviewsWritten) : 0;

    // Медиана РАБОЧИХ часов между сдачей записи и разбором. Два прежних упрощения убраны:
    // отсчёт шёл от создания черновика (время менеджера списывалось руководителю), а часы
    // считались календарными (выходные попадали в норматив). У записей, сданных до 10.08.2026,
    // момента сдачи в базе нет, там по-прежнему createdAt: другого источника не существует.
    const deltas: number[] = [];
    for (const e of reviewedEntries) {
      if (!e.reviewedAt) continue;
      const submitted = e.submittedAt ?? e.createdAt;
      if (new Date(e.reviewedAt).getTime() > new Date(submitted).getTime()) {
        deltas.push(businessHoursBetween(company?.timezone, submitted, e.reviewedAt));
      }
    }
    deltas.sort((a, b) => a - b);
    const medianHoursToRespond = deltas.length === 0
      ? 0
      : Math.round(deltas[Math.floor(deltas.length / 2)] * 10) / 10;

    const qualitativeCount = reviewedEntries.filter(
      (e) => (e.reviewText?.length ?? 0) >= norms.minReviewCharsAvg,
    ).length;
    const qualityPct = reviewsWritten > 0
      ? Math.round((qualitativeCount / reviewsWritten) * 100)
      : 0;

    // Просрочки — записи, ждущие разбора дольше норматива в РАБОЧИХ часах. База даёт грубых
    // кандидатов по календарю, решение принимается по рабочему времени компании.
    const overdueThresholdMs = Date.now() - norms.maxHoursToRespond * 3600 * 1000;
    const overdueRows = await this.entryRepo
      .createQueryBuilder('entry')
      .leftJoin('entry.manager', 'manager')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.status = :status', { status: EntryStatus.SUBMITTED })
      .andWhere('COALESCE(entry.submittedAt, entry.createdAt) <= :threshold', {
        threshold: new Date(overdueThresholdMs),
      })
      .andWhere('entry.deletedAt IS NULL')
      .select(['entry.id', 'entry.createdAt', 'entry.submittedAt', 'entry.sprintId', 'manager.fullName'])
      .getMany();
    const overdue = overdueRows
      .map((e) => ({
        id: e.id,
        // sprintId нужен, чтобы ссылка из очереди вела на доску нужного спринта:
        // просрочки часто из прошлых спринтов, а /sprint без id открывает только активный.
        sprintId: e.sprintId,
        managerName: e.manager?.fullName ?? '—',
        hoursWaiting: businessHoursBetween(company?.timezone, e.submittedAt ?? e.createdAt),
      }))
      .filter((row) => row.hoursWaiting > norms.maxHoursToRespond);

    // normStatus — светофор
    let normStatus: 'green' | 'yellow' | 'red' | 'no-norm' = 'no-norm';
    if (norms.minReviewsPerWeek > 0) {
      const reviewsRatio = reviewsWritten / norms.minReviewsPerWeek;
      const overdueCount = overdue.length;
      if (reviewsRatio >= 1 && medianHoursToRespond <= norms.maxHoursToRespond && qualityPct >= norms.qualityThresholdPct && overdueCount === 0) {
        // Зелёный только без хвоста просрочек: иначе РОП «набивает» текущую неделю, игнорируя старый долг.
        normStatus = 'green';
      } else if (reviewsRatio >= 0.5 && overdueCount < 5) {
        normStatus = 'yellow';
      } else {
        normStatus = 'red';
      }
    }

    const streak = await this.getReviewerWeeklyStreak(companyId, reviewerId);

    return {
      reviewerId,
      reviewerName,
      reviewsWritten,
      reviewDays,
      targetReviews: norms.minReviewsPerWeek,
      avgReviewChars,
      medianHoursToRespond,
      qualityPct,
      norms,
      normStatus,
      overdue,
      streakWeeks: streak.currentStreak,
      bestStreakWeeks: streak.bestStreak,
    };
  }

  /**
   * Активити-паттерны менеджера: распределение записей по дням недели (0=пн...6=вс) и часам (0-23).
   * + средняя длина самоанализа по дню недели.
   * Идея (Роман Виас): не только контент, но и паттерны работы во времени.
   */
  async getActivityPatterns(companyId: string, managerId?: string) {
    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.deletedAt IS NULL');
    if (managerId) {
      qb.andWhere('entry.managerId = :managerId', { managerId });
    }
    const entries = await qb.getMany();

    // Day of week: 0=Mon ... 6=Sun. JS getDay(): 0=Sun, 1=Mon... → нормализуем.
    const byDow = Array.from({ length: 7 }, () => ({
      count: 0,
      selfReviewLenSum: 0,
      withSelfReviewCount: 0,
    }));
    const byHour = Array.from({ length: 24 }, () => 0);

    for (const e of entries) {
      const d = new Date(e.createdAt);
      const jsDow = d.getDay();
      const dow = jsDow === 0 ? 6 : jsDow - 1; // Пн=0 ... Вс=6
      const hour = d.getHours();
      byDow[dow].count++;
      byHour[hour]++;

      const selfLen = (e.selfReviewCorrect?.length ?? 0)
        + (e.selfReviewImprove?.length ?? 0)
        + (e.selfReviewSuggestions?.length ?? 0);
      if (selfLen > 0) {
        byDow[dow].selfReviewLenSum += selfLen;
        byDow[dow].withSelfReviewCount++;
      }
    }

    const dowNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
    const daysOfWeek = byDow.map((d, i) => ({
      day: dowNames[i],
      count: d.count,
      avgSelfReviewLength: d.withSelfReviewCount > 0
        ? Math.round(d.selfReviewLenSum / d.withSelfReviewCount)
        : 0,
    }));

    const hours = byHour.map((count, h) => ({ hour: h, count }));

    return {
      totalEntries: entries.length,
      daysOfWeek,
      hours,
    };
  }

  /**
   * Выгрузка разборов с тегами и примерами — материал для методички.
   * Необязательный период (from/to) фильтрует по дате ревью (reviewedAt):
   * для методички берётся окно 4–6 недель. Без периода — вся история (как раньше).
   */
  async exportData(companyId: string, from?: Date, to?: Date) {
    const qb = this.entryRepo
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.manager', 'manager')
      .innerJoinAndSelect('entry.sprint', 'sprint')
      .leftJoinAndSelect('entry.errorTags', 'tag')
      .leftJoinAndSelect('entry.screenshots', 'screenshot')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.status = :status', { status: EntryStatus.REVIEWED })
      .andWhere('entry.deletedAt IS NULL');
    if (from) qb.andWhere('entry.reviewedAt >= :from', { from });
    if (to) qb.andWhere('entry.reviewedAt <= :to', { to });
    const entries = await qb
      .select([
        'entry.id',
        'entry.type',
        'entry.transcription',
        'entry.selfReviewCorrect',
        'entry.selfReviewImprove',
        'entry.selfReviewSuggestions',
        'entry.reviewText',
        'entry.entryNumber',
        'entry.entryDate',
        'manager.fullName',
        'sprint.label',
        'tag.id',
        'tag.name',
        'tag.description',
        'screenshot.id',
        'screenshot.fileUrl',
        'screenshot.fileName',
        'screenshot.extractedText',
      ])
      .getMany();

    // Group by error tag
    const tagPatterns = new Map<string, {
      tagId: string;
      tagName: string;
      description?: string;
      totalOccurrences: number;
      examples: Array<{
        sprintLabel: string;
        managerName: string;
        entryType: string;
        excerpt: string;
        reviewExcerpt: string;
      }>;
    }>();

    for (const entry of entries) {
      for (const tag of (entry.errorTags ?? [])) {
        if (!tagPatterns.has(tag.id)) {
          tagPatterns.set(tag.id, {
            tagId: tag.id,
            tagName: tag.name,
            description: tag.description,
            totalOccurrences: 0,
            examples: [],
          });
        }
        const pattern = tagPatterns.get(tag.id)!;
        pattern.totalOccurrences++;
        if (pattern.examples.length < 3) {
          // Для переписок — вставленный менеджером текст диалога, иначе OCR из скриншотов
          // (текст точнее распознавания и с 05.08.2026 есть у части переписок).
          let excerpt: string;
          if (entry.type === EntryType.CHAT && entry.transcription) {
            excerpt = `«${entry.transcription.substring(0, 150)}...»`;
          } else if (entry.type === EntryType.CHAT && entry.screenshots?.length) {
            const ocrText = entry.screenshots
              .map(s => s.extractedText)
              .filter(Boolean)
              .join('\n---\n');
            excerpt = ocrText
              ? `«${ocrText.substring(0, 150)}...»`
              : '[скриншоты без распознанного текста]';
          } else if (entry.transcription) {
            excerpt = `«${entry.transcription.substring(0, 150)}...»`;
          } else {
            excerpt = '[нет содержимого]';
          }
          const reviewExcerpt = entry.reviewText
            ? entry.reviewText.substring(0, 200)
            : '';
          pattern.examples.push({
            sprintLabel: entry.sprint?.label ?? '',
            managerName: entry.manager?.fullName ?? '',
            entryType: entry.type,
            excerpt,
            reviewExcerpt,
          });
        }
      }
    }

    const sprints = await this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId })
      .select('DISTINCT entry.sprintId', 'sprintId')
      .getRawMany();

    // Подготовить полный список записей с OCR-данными для методички
    const entriesWithOcr = entries.map(entry => ({
      id: entry.id,
      type: entry.type,
      entryNumber: entry.entryNumber,
      entryDate: entry.entryDate,
      sprintLabel: entry.sprint?.label ?? '',
      managerName: entry.manager?.fullName ?? '',
      // Текст диалога есть и у переписки, вставленной словами (с 05.08.2026), — отдаём его
      // независимо от типа, иначе выгрузка для аналитика теряет содержимое таких записей.
      transcription: entry.transcription,
      selfReview: {
        correct: entry.selfReviewCorrect,
        improve: entry.selfReviewImprove,
        suggestions: entry.selfReviewSuggestions,
      },
      reviewText: entry.reviewText,
      errorTags: (entry.errorTags ?? []).map(t => t.name),
      screenshots: entry.type === EntryType.CHAT
        ? (entry.screenshots ?? []).map(s => ({
            fileUrl: s.fileUrl,
            fileName: s.fileName,
            extractedText: s.extractedText ?? null,
          }))
        : [],
    }));

    return {
      company: companyId,
      generatedAt: new Date().toISOString(),
      totalSprintsAnalyzed: sprints.length,
      totalReviewedEntries: entries.length,
      entries: entriesWithOcr,
      errorPatterns: Array.from(tagPatterns.values()).map(p => ({
        tagName: p.tagName,
        description: p.description,
        totalOccurrences: p.totalOccurrences,
        examples: p.examples,
      })),
    };
  }
}
