import type { CompanyStatus } from './entities/company.entity';
import { idleWorkingDays } from '../common/company-time.util';

/**
 * Здоровье работы: считает ТОЛЬКО система, из фактов (записи, разборы, входы). Человек владеет
 * намерением (`status`), система владеет фактом (`health`), и они хранятся отдельно и никогда
 * не переписывают друг друга (разбор жизненного цикла, часть 3.1).
 *
 * Смысл разделения в одной строке: «мы считаем, что работаем, а записей нет 22 дня» — фраза,
 * которую сегодня невыразить, потому что поле одно и показывает то, что кто-то выбрал руками.
 *
 * Чистая функция без репозиториев — иначе её нельзя проверить без поднятого контейнера
 * (правило «расчёт, который нельзя проверить без базы, остаётся непокрытым»).
 */
export type CompanyHealthState =
  | 'not_started'  // записей не было НИКОГДА
  | 'ramping'      // первая неделя после запуска, записи пошли
  | 'running'      // работа идёт
  | 'lagging'      // записи есть, но разбор отстаёт или темп упал
  | 'silent';      // записи были, но давно

export interface CompanyHealthInput {
  status: CompanyStatus;
  /** Начало отсчёта работы: kick-off, иначе старт работы, иначе создание компании. */
  startedAt: Date | string;
  /**
   * Дата последней СДАННОЙ записи. null = сданных записей не было никогда.
   * Раньше сюда приходила последняя запись любого статуса, включая черновик: менеджер
   * заводил запись, бросал её, и компания выглядела работающей, хотя до РОПа не доехало
   * ничего (правка 09.08.2026, три брошенных черновика клиента).
   */
  lastEntryAt: Date | string | null;
  /**
   * Черновики, начатые и не отправленные дольше двух суток. Это не тишина и не работа,
   * а отдельное состояние: человек попробовал и застрял, и ему нужна помощь, а не напоминание.
   */
  staleDrafts?: number;
  /** Сданных записей за последние 7 дней. */
  submittedLast7d: number;
  /** Сданных записей всего. */
  submittedTotal: number;
  /** Разобранных РОПом записей всего. */
  reviewedTotal: number;
  /** Сколько человек команды заведено и ни разу не входило. */
  neverLoggedIn: number;
  /** Таймзона компании: рабочие дни считаются по её календарю, а не по серверному. */
  timezone?: string | null;
  /**
   * Окно приостановки за неоплату: когда МЫ закрыли платформу команде и когда открыли обратно
   * (`to` пуст у действующей). Эти дни из простоя вычитаются: сдать запись было физически
   * нельзя, и считать их ленью клиента значит выставлять ему наш же счёт. У клиента это дало
   * «18 дней без новых записей», из которых десять рабочих закрыли мы (13 и 23.08.2026).
   */
  paymentHold?: { from: Date | string; to?: Date | string | null } | null;
  /** Текущий момент (передаётся явно, чтобы тест не зависел от часов машины). */
  now?: Date;
}

export interface CompanyHealth {
  state: CompanyHealthState;
  /** Короткая строка для интерфейса: «Работа стоит 112 дней». */
  label: string;
  /** Пояснение: что именно система видит в данных. */
  detail: string;
  /** Дней в этом состоянии (для сортировки и текстов сигналов). */
  days: number;
  /**
   * Ручной статус противоречит фактам. Именно это расхождение и есть главный продукт модели:
   * оно требует ответа человека, а не молчаливого сосуществования двух правд.
   */
  mismatch: boolean;
  mismatchText: string | null;
}

const DAY = 86_400_000;

function daysBetween(from: Date | string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / DAY);
}

export function computeCompanyHealth(input: CompanyHealthInput): CompanyHealth {
  const now = input.now ?? new Date();
  // Простой меряется РАБОЧИМИ днями клиента: суббота и воскресенье это не тишина, а выходные
  // (решение владельца продукта). Дни действующей или уже снятой приостановки вычитаются:
  // пока платформа закрыта нами, работать команда не может.
  const hold = input.paymentHold?.from ? input.paymentHold : null;
  const holdSince = hold ? new Date(hold.from) : null;
  const holdActive = Boolean(holdSince && !hold?.to);
  const tz = input.timezone;
  const idle = (from: Date | string) => idleWorkingDays(tz, from, now, hold ?? null);
  const sinceStart = idle(input.startedAt);

  let state: CompanyHealthState;
  let days: number;
  let label: string;
  let detail: string;

  const staleDrafts = input.staleDrafts ?? 0;

  if (!input.lastEntryAt) {
    state = 'not_started';
    days = Math.max(sinceStart, 0);
    label = `Не начинали, ${days} ${pluralWorkdays(days)}`;
    detail =
      input.neverLoggedIn > 0
        ? `Ни одной сданной записи за всё время. Не входили на платформу: ${input.neverLoggedIn}.`
        : 'Ни одной сданной записи за всё время.';
  } else {
    const quiet = idle(input.lastEntryAt);
    if (quiet >= 5) {
      state = 'silent';
      days = quiet;
      label = `Работа стоит ${days} ${pluralWorkdays(days)}`;
      detail = `Последняя сданная запись ${new Date(input.lastEntryAt).toLocaleDateString('ru-RU')}.`;
    } else if (sinceStart <= 5) {
      state = 'ramping';
      days = Math.max(sinceStart, 0);
      label = 'Разгон, первая неделя';
      detail = `Сдано записей: ${input.submittedTotal}, разобрано: ${input.reviewedTotal}.`;
    } else {
      // Отстаём, если разбирают меньше половины сданного либо неделя пустая по сдаче.
      const coverage = input.submittedTotal > 0 ? input.reviewedTotal / input.submittedTotal : 0;
      const lagging = input.submittedLast7d === 0 || coverage < 0.5;
      state = lagging ? 'lagging' : 'running';
      days = quiet;
      label = lagging ? 'Отстаёт' : 'Работа идёт';
      detail =
        input.submittedLast7d === 0
          ? 'За последние 7 дней ни одной сданной записи.'
          : `За 7 дней сдано ${input.submittedLast7d}, разобрано всего ${input.reviewedTotal} из ${input.submittedTotal}.`;
    }
  }

  // Начатое и неотправленное показывается в ЛЮБОМ состоянии, а не только когда сдач нет вовсе:
  // «разгон» с тремя брошенными черновиками выглядит как работа, хотя до РОПа не доехало ничего
  // (у клиента после перезапуска было ровно так). Человеку тут мешает не мотивация, а конкретный
  // шаг формы, и это другой разговор, чем напоминание «сдавайте записи».
  if (staleDrafts > 0) {
    detail += ` Начатых и неотправленных записей: ${staleDrafts}.`;
  }

  if (holdSince) {
    detail += holdActive
      ? ` Доступ закрыт нами за неоплату ${holdSince.toLocaleDateString('ru-RU')}, ` +
        'дальше состояние не меняется: работать команда не может.'
      : ` Дни приостановки за неоплату (с ${holdSince.toLocaleDateString('ru-RU')} ` +
        `по ${new Date(hold!.to!).toLocaleDateString('ru-RU')}) в простой не засчитаны.`;
  }

  // Расхождение намерения и факта. «Закрыта» и «Демо» из проверки исключены сознательно:
  // там отсутствие работы и есть ожидаемое состояние. Приостановка за неоплату исключена по
  // той же причине: тишина при закрытом нами доступе это не расхождение, а прямое следствие
  // нашего решения, и требовать по ней ответа человека не от кого.
  let mismatch = false;
  let mismatchText: string | null = null;
  if (holdActive) {
    // расхождения нет по построению
  } else if (input.status === 'active' && (state === 'not_started' || state === 'silent')) {
    mismatch = true;
    mismatchText = `Статус «Активна», а по данным ${label.toLowerCase()}.`;
  } else if (input.status === 'launch' && state === 'not_started' && sinceStart >= 5) {
    mismatch = true;
    mismatchText = `Статус «Запуск» уже ${sinceStart} ${pluralWorkdays(sinceStart)}, а первой записи так и нет.`;
  } else if (input.status === 'paused' && state !== 'not_started' && state !== 'silent') {
    mismatch = true;
    mismatchText = 'Статус «На паузе», а записи продолжают приходить.';
  }

  return { state, label, detail, days, mismatch, mismatchText };
}

function pluralWorkdays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'рабочий день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'рабочих дня';
  return 'рабочих дней';
}

function pluralDays(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}
