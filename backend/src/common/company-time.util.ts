/**
 * Время в таймзоне компании. Клиенты платформы живут от Калининграда до Камчатки
 * (UTC+2…UTC+12): граница недели, дни-дедлайны и утренние отчёты должны считаться
 * по локальному времени клиента, а не по серверному (аудит 3.0: «в субботу не
 * заполнили — конец недели уже был», премия РОПа искажалась переносом выходных).
 *
 * Без внешних библиотек: Intl.DateTimeFormat, доступен в Node из коробки.
 * Российские таймзоны без переходов на летнее время — почасовые кроны с проверкой
 * локального часа срабатывают ровно один раз в сутки.
 */

export const DEFAULT_TIMEZONE = 'Europe/Moscow';

export interface LocalParts {
  y: number;
  m: number; // 1–12
  d: number; // 1–31
  isoWeekday: number; // 1 = понедельник … 7 = воскресенье
  hour: number; // 0–23
  dateStr: string; // 'YYYY-MM-DD'
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      weekday: 'short',
      hour12: false,
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Части локальной даты/времени компании. Невалидная таймзона → Москва. */
export function localParts(tz: string | null | undefined, at: Date = new Date()): LocalParts {
  let f: Intl.DateTimeFormat;
  try {
    f = formatterFor(tz || DEFAULT_TIMEZONE);
  } catch {
    f = formatterFor(DEFAULT_TIMEZONE);
  }
  const parts: Record<string, string> = {};
  for (const p of f.formatToParts(at)) parts[p.type] = p.value;
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);
  // Intl может отдать hour '24' на полуночи — нормализуем
  const hour = Number(parts.hour) % 24;
  return {
    y, m, d, hour,
    isoWeekday: WEEKDAYS[parts.weekday] ?? 1,
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export interface WeekBounds {
  startDate: string; // пн, 'YYYY-MM-DD'
  endDate: string; // вс, 'YYYY-MM-DD'
  monday: { y: number; m: number; d: number };
  sunday: { y: number; m: number; d: number };
}

/** Смещение таймзоны относительно UTC в мс (все зоны РФ — целочасовые, без DST). */
export function tzOffsetMs(tz: string | null | undefined, at: Date = new Date()): number {
  const lp = localParts(tz, at);
  const asUtc = Date.UTC(lp.y, lp.m - 1, lp.d, lp.hour);
  const atFloorHour = Math.floor(at.getTime() / 3_600_000) * 3_600_000;
  return asUtc - atFloorHour;
}

/** Момент (Date) локальной полуночи понедельника текущей недели компании. */
export function startOfWeekMoment(tz: string | null | undefined, at: Date = new Date()): Date {
  const wb = weekBoundsFor(tz, at);
  const utcMidnight = Date.UTC(wb.monday.y, wb.monday.m - 1, wb.monday.d);
  return new Date(utcMidnight - tzOffsetMs(tz, at));
}

/**
 * UTC-моменты начала/конца календарного месяца ПО ЛОКАЛЬНОЙ дате компании, не по UTC (CALC10).
 * Для Камчатки/Магадана/Владивостока (UTC+9…+12) последние часы месяца по серверному UTC уже
 * относились к следующему месяцу компании — записи утекали в чужой период, искажая % и снапшот.
 */
export function monthBoundsMs(tz: string | null | undefined, year: number, month: number): { start: Date; end: Date } {
  const startUtcMidnight = Date.UTC(year, month - 1, 1);
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const endUtcMidnight = Date.UTC(nextMonth.y, nextMonth.m - 1, 1);
  return {
    start: new Date(startUtcMidnight - tzOffsetMs(tz, new Date(startUtcMidnight))),
    end: new Date(endUtcMidnight - tzOffsetMs(tz, new Date(endUtcMidnight))),
  };
}

/** Границы ТЕКУЩЕГО календарного месяца по локальной дате компании (см. monthBoundsMs). */
export function currentMonthBoundsMs(tz: string | null | undefined, at: Date = new Date()): { start: Date; end: Date } {
  const lp = localParts(tz, at);
  return monthBoundsMs(tz, lp.y, lp.m);
}

/**
 * Разгонная (стартовая) неделя: компанию запустили НЕ с понедельника (Company.workStartedAt —
 * день, с которого команда реально начала работать). Первая неполная неделя не должна держать
 * команду под полным недельным нормативом и не должна сравниваться в аналитике наравне с полными:
 * пороги урезаются пропорционально остатку рабочих дней (Пн–Пт) от дня запуска, а сама неделя
 * помечается «разгонной». Проверяется по совпадению ISO-недели `at` с ISO-неделей запуска.
 *
 * @param company workStartedAt (день запуска, null → разгона нет) + timezone
 * @param at любой момент внутри проверяемой недели (напр. начало спринта или «сейчас»)
 * @returns isRampUp — это разгонная неделя; factor — множитель порогов (1 = полная неделя)
 */
export function rampUpWeek(
  company: { workStartedAt?: Date | string | null; timezone?: string | null },
  at: Date = new Date(),
): { isRampUp: boolean; factor: number } {
  const launched = company.workStartedAt ? new Date(company.workStartedAt) : null;
  if (!launched || isNaN(launched.getTime())) return { isRampUp: false, factor: 1 };
  const tz = company.timezone;
  // Одна и та же ISO-неделя (сравниваем по дате понедельника, не по мс — устойчиво к смещениям).
  if (weekBoundsFor(tz, launched).startDate !== weekBoundsFor(tz, at).startDate) {
    return { isRampUp: false, factor: 1 };
  }
  const isoWd = localParts(tz, launched).isoWeekday; // 1 = пн … 7 = вс
  if (isoWd === 1) return { isRampUp: false, factor: 1 }; // запуск в понедельник — неделя полная
  const workingLeft = Math.max(0, 5 - (isoWd - 1)); // остаток рабочих дней Пн–Пт от дня запуска
  return { isRampUp: true, factor: workingLeft / 5 };
}

/** Недельный порог, урезанный под разгонную неделю (минимум 1, чтобы зона была достижима). */
export function scaleThreshold(threshold: number, factor: number): number {
  return factor >= 1 ? threshold : Math.max(1, Math.round(threshold * factor));
}

/**
 * Сколько полных РАБОЧИХ дней (Пн–Пт) прошло с момента `since` по локальному календарю компании.
 *
 * Нужна порогам подключения человека: «не вошёл два дня» не должно сгорать за субботу и
 * воскресенье, иначе клиент из пятницы получает эскалацию в понедельник утром за то, что
 * его сотрудник не работал в выходные. Праздники не учитываем сознательно: производственный
 * календарь это отдельная сущность, а ошибка в один день здесь ничего не ломает.
 */
export function workingDaysSince(
  tz: string | null | undefined,
  since: Date | string,
  at: Date = new Date(),
): number {
  const from = since instanceof Date ? since : new Date(since);
  if (Number.isNaN(from.getTime())) return 0;
  const s = localParts(tz, from);
  const n = localParts(tz, at);
  let cursor = Date.UTC(s.y, s.m - 1, s.d);
  const end = Date.UTC(n.y, n.m - 1, n.d);
  let count = 0;
  // Защита от бесконечного цикла при кривой дате из прошлого века: больше года не считаем.
  let guard = 400;
  while (cursor < end && guard-- > 0) {
    cursor += 86_400_000;
    const wd = new Date(cursor).getUTCDay(); // 0 = вс, 6 = сб
    if (wd !== 0 && wd !== 6) count++;
  }
  return count;
}

/** Рабочий день команды продаж: с 9:00 до 18:00 по местному времени компании. */
export const WORK_DAY_START_HOUR = 9;
export const WORK_DAY_END_HOUR = 18;
/** Шаг обхода интервала. 15 минут: точность выше десятой доли часа, стоимость копеечная. */
const BUSINESS_STEP_MS = 15 * 60 * 1000;

/**
 * Сколько РАБОЧИХ часов прошло между двумя моментами по календарю компании.
 *
 * Норматив «разобрать запись за 24 часа» это про рабочее время руководителя, а не про
 * астрономическое. Считая подряд, платформа записывала в просрочку выходные: у одного клиента
 * запись, сданная в пятницу днём и разобранная в понедельник утром, числилась ожидающей
 * 72 часа, хотя РОП ответил в первые же рабочие часы. Из шестнадцати разобранных записей
 * девять были помечены просрочкой, и владелец видел это в отчёте как провал дисциплины.
 *
 * Праздники сознательно не учитываем: производственный календарь это отдельная сущность,
 * а ошибка в один день здесь никого не наказывает несправедливо (порог 24 часа это три
 * рабочих дня по восемь, запас большой).
 */
export function businessHoursBetween(
  tz: string | null | undefined,
  from: Date | string,
  to: Date | string = new Date(),
): number {
  const start = from instanceof Date ? from : new Date(from);
  const end = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  if (end <= start) return 0;

  let cursor = start.getTime();
  const endMs = end.getTime();
  let workedMs = 0;
  // Защита от кривой даты из прошлого века: дальше трёх месяцев считать бессмысленно,
  // такая запись давно просрочена по любому счёту.
  const hardStop = cursor + 92 * 86_400_000;

  while (cursor < endMs && cursor < hardStop) {
    const step = Math.min(BUSINESS_STEP_MS, endMs - cursor);
    const lp = localParts(tz, new Date(cursor));
    const isWorkday = lp.isoWeekday >= 1 && lp.isoWeekday <= 5;
    const isWorkHour = lp.hour >= WORK_DAY_START_HOUR && lp.hour < WORK_DAY_END_HOUR;
    if (isWorkday && isWorkHour) workedMs += step;
    cursor += step;
  }

  return Math.round((workedMs / 3_600_000) * 10) / 10;
}

/** Границы текущей ISO-недели (пн–вс) по локальной дате компании. */
export function weekBoundsFor(tz: string | null | undefined, at: Date = new Date()): WeekBounds {
  const lp = localParts(tz, at);
  // Дальше — чистая календарная арифметика по числам (Date.UTC как счётчик дней)
  const mondayMs = Date.UTC(lp.y, lp.m - 1, lp.d - (lp.isoWeekday - 1));
  const sundayMs = mondayMs + 6 * 86_400_000;
  const md = new Date(mondayMs);
  const sd = new Date(sundayMs);
  const toStr = (x: Date) => x.toISOString().split('T')[0];
  return {
    startDate: toStr(md),
    endDate: toStr(sd),
    monday: { y: md.getUTCFullYear(), m: md.getUTCMonth() + 1, d: md.getUTCDate() },
    sunday: { y: sd.getUTCFullYear(), m: sd.getUTCMonth() + 1, d: sd.getUTCDate() },
  };
}

/**
 * Сколько РАЗНЫХ дней недели человек реально работал (по локальному времени компании).
 *
 * Отличает «10 записей за 4 дня» от «10 записей в четверг вечером»: объём одинаковый, а
 * навык растёт только в первом случае. Без этой метрики поведение невидимо, а значит
 * неуправляемо (решение владельца продукта про ежедневную привычку).
 */
export function activeDaysCount(tz: string | null | undefined, dates: (Date | string | null | undefined)[]): number {
  const days = new Set<string>();
  for (const d of dates) {
    if (!d) continue;
    const at = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(at.getTime())) continue;
    const p = localParts(tz, at);
    days.add(`${p.y}-${p.m}-${p.d}`);
  }
  return days.size;
}

/**
 * Рабочие дни простоя: сколько дней клиент МОГ работать и не работал.
 *
 * Отличается от `workingDaysSince` вычетом окна, в котором работа была невозможна по НАШЕЙ
 * вине: приостановка за неоплату закрывает платформу всей команде. Считать эти дни простоем
 * значит выставлять клиенту наш же счёт как его лень (23.08.2026: клиента показывался как «18 дней
 * без новых записей», хотя 10 из них платформа была закрыта нами, а два были выходными).
 *
 * Окно передаётся парой: `from` обязателен, `to` пуст у ещё действующей приостановки.
 */
export function idleWorkingDays(
  tz: string | null | undefined,
  since: Date | string,
  at: Date = new Date(),
  hold?: { from: Date | string; to?: Date | string | null } | null,
): number {
  const total = workingDaysSince(tz, since, at);
  if (!hold?.from) return total;
  const holdFrom = hold.from instanceof Date ? hold.from : new Date(hold.from);
  const holdTo = hold.to ? (hold.to instanceof Date ? hold.to : new Date(hold.to)) : at;
  if (Number.isNaN(holdFrom.getTime()) || Number.isNaN(holdTo.getTime())) return total;
  const sinceDate = since instanceof Date ? since : new Date(since);
  // Пересечение окна простоя с окном приостановки: вычитаем только его.
  const from = holdFrom > sinceDate ? holdFrom : sinceDate;
  const to = holdTo < at ? holdTo : at;
  if (to <= from) return total;
  return Math.max(0, total - workingDaysSince(tz, from, to));
}
