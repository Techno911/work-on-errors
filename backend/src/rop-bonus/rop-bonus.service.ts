import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company, RopBonusTier, RopBonusData, DEFAULT_REVIEW_NORMS } from '../companies/entities/company.entity';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { RopBonusSnapshot } from './entities/rop-bonus-snapshot.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { localParts, tzOffsetMs, monthBoundsMs } from '../common/company-time.util';

export interface RopBonusMonthStats {
  period: string;
  enabled: boolean;
  // Режим расчёта: 'linear' — премия = baseAmount × % (по договору), 'tiers' — ступени (легаси).
  mode: 'linear' | 'tiers';
  baseAmount: number | null;
  minThresholdPct: number | null;
  tiers: RopBonusTier[];
  maxHoursToRespond: number;
  onTimeCount: number;
  lateCount: number;
  // короткие ревью (меньше minReviewChars), сданные вовремя, но не в зачёте — подмножество lateCount
  shortCount: number;
  pendingCount: number;
  onTimePct: number | null;
  bestCasePct: number | null;
  minReviewChars: number;
  workdaysOnly: boolean;
  currentAmount: number;
  currentTier: RopBonusTier | null;
  bestCaseAmount: number;
  bestCaseTier: RopBonusTier | null;
  nextTier: RopBonusTier | null;
  daysLeftInMonth: number;
  payoutDay: number | null;
  ropName: string | null;
  // true = месяц зафиксирован снапшотом в день расчёта и не пересчитывается
  frozen?: boolean;
  // дата фиксации снапшота (ISO), только для frozen-месяцев
  frozenAt?: string | null;
}

@Injectable()
export class RopBonusService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(Entry)
    private readonly entryRepo: Repository<Entry>,
    @InjectRepository(RopBonusSnapshot)
    private readonly snapshotRepo: Repository<RopBonusSnapshot>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Дедлайн с учётом рабочих дней: суббота/воскресенье переносятся на понедельник 12:00.
   * День недели и «понедельник 12:00» — в таймзоне компании: у Камчатки суббота
   * наступает на 9 часов раньше серверной, без этого РОП терял «в срок» (деньги).
   */
  private effectiveDeadline(createdAt: Date, maxMs: number, workdaysOnly: boolean, tz?: string | null): number {
    const deadline = new Date(createdAt.getTime() + maxMs);
    if (!workdaysOnly) return deadline.getTime();
    const lp = localParts(tz, deadline);
    const shiftDays = lp.isoWeekday === 6 ? 2 : lp.isoWeekday === 7 ? 1 : 0;
    if (shiftDays === 0) return deadline.getTime();
    // Локальный понедельник 12:00 → обратно в абсолютный момент
    const localNoonUtc = Date.UTC(lp.y, lp.m - 1, lp.d + shiftDays, 12);
    return localNoonUtc - tzOffsetMs(tz, deadline);
  }

  /**
   * Премия РОПа за месяц: % ревью команды «в срок» против тиров из company.ropBonus.
   * «В срок» = reviewedAt <= submittedAt + maxHoursToRespond, где submittedAt это момент сдачи
   * записи руководителю. Просроченные неотревьюенные считаются «не в срок»,
   * pending в пределах дедлайна исключаются из расчёта целиком.
   */
  // preloadedCompany — для вызывающих, у которых Company уже в памяти (schedulers, admin dashboard):
  // избегаем повторного findOne на каждую компанию в цикле (N1/PERF1).
  async getMonthStats(companyId: string, period?: string, preloadedCompany?: Company): Promise<RopBonusMonthStats> {
    const company = preloadedCompany ?? await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException(`Компания с id ${companyId} не найдена`);
    }
    const { year, month } = this.parsePeriod(period);
    // Закрытый месяц с снапшотом отдаём из снимка — иначе два API расходятся в сумме за один период
    const now = new Date();
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    if (!isCurrentMonth) {
      const snapPeriod = `${year}-${String(month).padStart(2, '0')}`;
      const snap = await this.snapshotRepo.findOne({ where: { companyId, period: snapPeriod } });
      if (snap) return this.snapshotToStats(company, snap);
    }
    return this.computeMonth(company, year, month);
  }

  /** История по месяцам: текущий и назад. Расчёт на лету по текущему нормативу. */
  async getHistory(companyId: string, months = 6): Promise<RopBonusMonthStats[]> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException(`Компания с id ${companyId} не найдена`);
    }
    const count = Math.min(Math.max(months, 1), 12);
    const now = new Date();
    const result: RopBonusMonthStats[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      // Закрытые месяцы читаем из снапшота — финансовая история не мутирует
      const snap = i === 0 ? null : await this.snapshotRepo.findOne({ where: { companyId, period } });
      if (snap) {
        result.push(this.snapshotToStats(company, snap));
      } else {
        result.push(await this.computeMonth(company, d.getFullYear(), d.getMonth() + 1));
      }
    }
    return result;
  }

  private async computeMonth(company: Company, year: number, month: number): Promise<RopBonusMonthStats> {
    const ropBonus = company.ropBonus ?? { enabled: false, tiers: [] };
    const tiers = this.normalizeTiers(ropBonus.tiers);
    const maxHours = company.reviewNorms?.maxHoursToRespond || DEFAULT_REVIEW_NORMS.maxHoursToRespond;
    // Качество в денежной формуле: ревью короче минимума — отписка, «в срок» не засчитывается
    const minReviewChars = company.minReviewChars || 150;

    const workdaysOnly = ropBonus.workdaysOnly !== false;
    // Границы месяца — по локальной дате компании, не по UTC-серверной (CALC10).
    const { start: monthStart, end: monthEnd } = monthBoundsMs(company.timezone, year, month);
    const now = new Date();
    const ropName = await this.resolveRopName(company.id);

    const entries = await this.entryRepo
      .createQueryBuilder('entry')
      .where('entry.companyId = :companyId', { companyId: company.id })
      .andWhere('entry.status IN (:...statuses)', {
        statuses: [EntryStatus.SUBMITTED, EntryStatus.REVIEWED],
      })
      .andWhere('entry.createdAt >= :monthStart', { monthStart })
      .andWhere('entry.createdAt < :monthEnd', { monthEnd })
      .andWhere('entry.deletedAt IS NULL')
      .select(['entry.id', 'entry.createdAt', 'entry.submittedAt', 'entry.reviewedAt', 'entry.reviewText'])
      .getMany();

    let onTimeCount = 0;
    let lateCount = 0;
    let shortCount = 0;
    let pendingCount = 0;
    const maxMs = maxHours * 3600 * 1000;
    for (const e of entries) {
      // Срок идёт от сдачи записи руководителю, а не от создания черновика: иначе время,
      // пока менеджер писал самоанализ, съедало срок РОПа, и это стоило ему денег.
      // У записей до 10.08.2026 момента сдачи нет, там прежний отсчёт от createdAt.
      const deadlineMs = this.effectiveDeadline(
        new Date(e.submittedAt ?? e.createdAt), maxMs, workdaysOnly, company.timezone,
      );
      if (e.reviewedAt) {
        const inTime = new Date(e.reviewedAt).getTime() <= deadlineMs;
        const qualified = (e.reviewText?.length ?? 0) >= minReviewChars;
        if (inTime && qualified) onTimeCount++;
        else if (!inTime) lateCount++;
        else shortCount++; // сдано вовремя, но короткое — не в зачёте отдельной причиной
      } else if (now.getTime() > deadlineMs) {
        lateCount++;
      } else {
        pendingCount++;
      }
    }

    // «Не в зачёте» = опоздавшие + короткие; на проценте обе категории сидят одинаково
    const counted = onTimeCount + lateCount + shortCount;
    // Точный процент нужен для round-half корректного показа и best-case; ДЕНЬГИ считаются
    // от ОКРУГЛЁННОГО onTimePct (см. ниже) — чтобы показ и выплата не расходились на границе порога.
    const exactPct = counted > 0 ? (onTimeCount / counted) * 100 : null;
    const exactBestPct =
      counted + pendingCount > 0 ? ((onTimeCount + pendingCount) / (counted + pendingCount)) * 100 : null;
    const onTimePct = exactPct === null ? null : Math.round(exactPct);
    const bestCasePct = exactBestPct === null ? null : Math.round(exactBestPct);

    const linear = this.isLinear(ropBonus);
    // Тиры имеют смысл только в ступенчатом режиме; в линейном — null.
    const currentTier = linear || onTimePct === null ? null : this.resolveTier(tiers, onTimePct);
    const bestCaseTier = linear || bestCasePct === null ? null : this.resolveTier(tiers, bestCasePct);
    const nextTier = linear
      ? null
      : [...tiers].reverse().find((t) => t.thresholdPct > (onTimePct ?? 0)) ?? null;
    // Премия — от ОКРУГЛЁННОГО % (того, что видит РОП), иначе на границе показ «60% ≥ порог 60%»
    // расходился бы с выплатой 0 ₽ (exactPct 59.6 → показ 60). Показ, тир и сумма теперь из одного onTimePct.
    const currentAmount = onTimePct === null ? 0 : this.amountForPct(ropBonus, tiers, onTimePct);
    const bestCaseAmount = bestCasePct === null ? 0 : this.amountForPct(ropBonus, tiers, bestCasePct);

    let daysLeftInMonth = 0;
    if (now >= monthStart && now < monthEnd) {
      daysLeftInMonth = Math.ceil((monthEnd.getTime() - now.getTime()) / (24 * 3600 * 1000));
    }

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      enabled: ropBonus.enabled === true,
      mode: linear ? 'linear' : 'tiers',
      baseAmount: linear ? ropBonus.baseAmount ?? null : null,
      minThresholdPct: linear ? ropBonus.minThresholdPct ?? 60 : null,
      tiers,
      maxHoursToRespond: maxHours,
      onTimeCount,
      lateCount,
      shortCount,
      pendingCount,
      onTimePct,
      bestCasePct,
      minReviewChars,
      workdaysOnly,
      currentAmount,
      currentTier,
      bestCaseAmount,
      bestCaseTier,
      nextTier,
      daysLeftInMonth,
      payoutDay: ropBonus.payoutDay ?? null,
      ropName,
    };
  }

  /**
   * Имя РОПа для отчётов. При нескольких активных ревьюерах вернуть «Команда ревью» —
   * иначе письмо назвало бы случайного из них. При одном — его имя.
   * Сортировка по createdAt/id детерминированна (важно, если логика «первого» вернётся).
   */
  private async resolveRopName(companyId: string): Promise<string | null> {
    const reviewers = await this.userRepo.find({
      where: { companyId, role: UserRole.REVIEWER, isActive: true },
      select: ['id', 'fullName'],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (reviewers.length === 0) return null;
    if (reviewers.length > 1) return 'Команда ревью';
    return reviewers[0].fullName ?? null;
  }

  /**
   * Фиксация ПРОШЛОГО (закрытого) месяца для всех компаний с включённой премией.
   * Вызывается cron'ом 1-го числа и catch-up'ом при старте приложения. Идемпотентно:
   * существующий снапшот не перезаписывается. Так история не зависит от payoutDay,
   * каналов рассылки и доступности рассыльщика — месяц фиксируется в любом случае.
   * @returns число созданных снапшотов
   */
  async snapshotPreviousMonthForAll(): Promise<number> {
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return this.backfillMissingSnapshots(prev.getFullYear(), prev.getMonth() + 1, prev.getFullYear(), prev.getMonth() + 1);
  }

  /**
   * Бэкафилл ВСЕХ закрытых месяцев без снапшота в окне [fromY-fromM .. toY-toM] включительно
   * (CALC1-history: закрытые месяцы без снапшота пересчитывались вживую по ТЕКУЩЕМУ нормативу —
   * смена норматива задним числом искажала старые суммы). Идемпотентно — существующие снапшоты
   * не трогает. Вызывается при каждом старте приложения на окно в 12 месяцев назад: не только
   * ловит простой в 1 месяц (даунтайм на границе месяца), но и самозалечивает произвольный
   * разрыв (недели без снапшотов, как у демо-компании за 2026-02..04) на каждом деплое без ручного скрипта.
   */
  async backfillMissingSnapshots(fromYear: number, fromMonth: number, toYear: number, toMonth: number): Promise<number> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    let created = 0;
    for (const company of companies) {
      if (!company.ropBonus?.enabled) continue;
      let y = fromYear, m = fromMonth;
      while (y < toYear || (y === toYear && m <= toMonth)) {
        const period = `${y}-${String(m).padStart(2, '0')}`;
        const existing = await this.snapshotRepo.findOne({ where: { companyId: company.id, period } });
        if (!existing) {
          await this.saveSnapshot(company, y, m);
          created++;
        }
        m++; if (m > 12) { m = 1; y++; }
      }
    }
    return created;
  }

  /** Фиксация закрытого месяца в день расчёта. Существующий снапшот не перезаписывается. */
  async saveSnapshot(company: Company, year: number, month: number): Promise<RopBonusSnapshot> {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const existing = await this.snapshotRepo.findOne({ where: { companyId: company.id, period } });
    if (existing) return existing;
    const stats = await this.computeMonth(company, year, month);
    try {
      return await this.snapshotRepo.save({
        companyId: company.id,
        period,
        onTimeCount: stats.onTimeCount,
        lateCount: stats.lateCount,
        shortCount: stats.shortCount,
        onTimePct: stats.onTimePct,
        maxHoursToRespond: stats.maxHoursToRespond,
        minReviewChars: stats.minReviewChars,
        workdaysOnly: stats.workdaysOnly,
        ropName: stats.ropName,
        tiers: stats.tiers,
        amount: stats.currentAmount,
      });
    } catch (err) {
      // Гонка: параллельный backfill/крон/payout вставил тот же (companyId, period) между findOne и
      // save → unique-violation (23505). Идемпотентно возвращаем уже созданный снапшот, не роняя цикл.
      if ((err as { code?: string }).code === '23505') {
        const raced = await this.snapshotRepo.findOne({ where: { companyId: company.id, period } });
        if (raced) return raced;
      }
      throw err;
    }
  }

  private snapshotToStats(company: Company, snap: RopBonusSnapshot): RopBonusMonthStats {
    const currentTier = snap.onTimePct === null ? null : this.resolveTier(snap.tiers ?? [], snap.onTimePct);
    const linear = this.isLinear(company.ropBonus ?? { enabled: false, tiers: [] });
    return {
      period: snap.period,
      enabled: company.ropBonus?.enabled === true,
      mode: linear ? 'linear' : 'tiers',
      baseAmount: linear ? company.ropBonus?.baseAmount ?? null : null,
      minThresholdPct: linear ? company.ropBonus?.minThresholdPct ?? 60 : null,
      tiers: snap.tiers ?? [],
      maxHoursToRespond: snap.maxHoursToRespond,
      onTimeCount: snap.onTimeCount,
      lateCount: snap.lateCount,
      shortCount: snap.shortCount ?? 0,
      pendingCount: 0,
      onTimePct: snap.onTimePct,
      bestCasePct: snap.onTimePct,
      // На момент фиксации, а не текущая настройка — иначе пересчёт «плывёт»
      minReviewChars: snap.minReviewChars ?? company.minReviewChars ?? 150,
      workdaysOnly: snap.workdaysOnly ?? true,
      currentAmount: snap.amount,
      currentTier,
      bestCaseAmount: snap.amount,
      bestCaseTier: currentTier,
      nextTier: null,
      daysLeftInMonth: 0,
      payoutDay: company.ropBonus?.payoutDay ?? null,
      ropName: snap.ropName ?? null,
      frozen: true,
      frozenAt: snap.createdAt ? new Date(snap.createdAt).toISOString() : null,
    };
  }

  /**
   * Тиры из JSONB могут прийти любыми — оставляем валидные, дедуплицируем пороги,
   * сортируем по убыванию порога. Дубль порога ломает resolveTier (берётся первый
   * по сортировке, второй мёртв) — при дубле оставляем больший amount.
   */
  private normalizeTiers(tiers: RopBonusTier[] | undefined): RopBonusTier[] {
    const valid = (Array.isArray(tiers) ? tiers : []).filter(
      (t) =>
        typeof t?.thresholdPct === 'number' &&
        t.thresholdPct >= 1 &&
        t.thresholdPct <= 100 &&
        typeof t?.amount === 'number' &&
        t.amount >= 0,
    );
    const byThreshold = new Map<number, number>();
    for (const t of valid) {
      const prev = byThreshold.get(t.thresholdPct);
      if (prev === undefined || t.amount > prev) byThreshold.set(t.thresholdPct, t.amount);
    }
    return [...byThreshold.entries()]
      .map(([thresholdPct, amount]) => ({ thresholdPct, amount }))
      .sort((a, b) => b.thresholdPct - a.thresholdPct);
  }

  private resolveTier(tiers: RopBonusTier[], pct: number): RopBonusTier | null {
    return tiers.find((t) => pct >= t.thresholdPct) ?? null;
  }

  /** Линейный режим (по договору): задана базовая сумма → премия = base × %, иначе ступени. */
  private isLinear(rb: RopBonusData): boolean {
    return typeof rb.baseAmount === 'number' && rb.baseAmount > 0;
  }

  /** Сумма премии за процент своевременности: линейно (base × %, отсечка) либо по ступеням. */
  private amountForPct(rb: RopBonusData, tiers: RopBonusTier[], pct: number): number {
    if (this.isLinear(rb)) {
      const min = rb.minThresholdPct ?? 60;
      if (pct < min) return 0;
      return Math.round(((rb.baseAmount as number) * pct) / 100);
    }
    return this.resolveTier(tiers, pct)?.amount ?? 0;
  }

  private parsePeriod(period?: string): { year: number; month: number } {
    if (!period) {
      const now = new Date();
      return { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException('Период должен быть в формате YYYY-MM');
    }
    const [y, m] = period.split('-').map(Number);
    return { year: y, month: m };
  }
}
