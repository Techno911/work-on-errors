import { createHash } from 'crypto';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffSignalState } from './entities/staff-signal-state.entity';
import { WatchdogRun } from './entities/watchdog-run.entity';
import { TelegramService } from './telegram.service';

/** Одна проблема в своде: устойчивый идентификатор, читаемая строка и ступень. */
export interface StaffSignal {
  /** Стабильный между прогонами: quiet:<companyId>. По нему узнаётся «это та же проблема». */
  id: string;
  /** Строка, которую читает человек. */
  text: string;
  /**
   * Ступень проблемы. Смена ступени = новость. Волатильные числа сюда не кладём:
   * «18 дней» → «19 дней» это не новость, а «первая неделя» → «вторая неделя» — новость.
   */
  stage?: string;
}

export interface StaffReportOptions {
  /** Подпись под сводом (контекст, не строка проблемы). */
  footer?: string;
  /** Через сколько дней напомнить о проблеме, которая не изменилась. */
  repeatAfterDays?: number;
  /** Ручной прогон человеком: он спросил сам, поэтому получает картину целиком. */
  force?: boolean;
  /** Что сказать на ручном прогоне, когда проблем нет. В автоматическом не используется. */
  emptyText?: string;
  /**
   * Сигналы, состояние которых в этом прогоне НЕ проверялось (проверка упала, источник
   * недоступен). Их отсутствие во входе не означает, что проблема снята: закрывать их
   * нельзя, иначе сбой проверки читается человеком как «починилось».
   */
  unverified?: string[];
}

export interface StaffReportResult {
  sent: boolean;
  chats: number;
  fresh: number;
  changed: number;
  repeated: number;
  closed: number;
  silent: number;
  open: number;
}

/** Сторожа, чьё молчание само по себе авария. Порядок задаёт порядок в админке. */
export const WATCHDOGS: { key: string; label: string; maxSilenceHours: number }[] = [
  // Свод по будням в 09:00: пятница плюс выходные плюс запас.
  { key: 'loop-health', label: 'свод здоровья петель', maxSilenceHours: 84 },
  // Понедельник 08:00.
  { key: 'channel-check', label: 'проверка каналов связи', maxSilenceHours: 8 * 24 },
  // Ежечасный обход: сам отчёт уходит в понедельник по локальному времени компании, но
  // отметку ставит каждый проход, иначе неделя без активных клиентов выглядела бы аварией.
  { key: 'weekly-report', label: 'обход недельных отчётов', maxSilenceHours: 4 },
  // Сторож сторожей: ежечасно. Его собственный разрыв это простой платформы, а не крона.
  { key: 'watchdog-liveness', label: 'сторож сторожей', maxSilenceHours: 4 },
];

const DEFAULT_REPEAT_DAYS = 14;
/** Проблема, прожившая меньше этого, закрывается молча: дребезг порога не новость. */
const MIN_LIFETIME_TO_ANNOUNCE_CLOSE_MS = 20 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Ширина колонки stage. Длиннее приходит легко: состав людей, список поломок канала. */
const STAGE_MAX = 64;

/**
 * Ступень нормализуется по длине, а не обрезается.
 *
 * Сторож собирает её из живых данных (идентификаторы не вошедших людей, перечень поломок
 * канала), и два человека в списке уже дают 73 символа при колонке в 64: вставка упала бы,
 * прогон свода оборвался бы исключением, и человек не получил бы НИЧЕГО — самый дорогой
 * исход для механизма, который заводился ради тишины. Обрезка не годится: два разных состава
 * с общим началом схлопнулись бы в одну ступень и ухудшение перестало бы быть новостью.
 */
export function normalizeStage(stage: string): string {
  if (stage.length <= STAGE_MAX) return stage;
  return `h:${createHash('sha1').update(stage).digest('hex').slice(0, 16)}`;
}

/**
 * ЕДИНСТВЕННАЯ дверь для сообщений НАШЕЙ стороне (владелец, трекеры).
 *
 * Правило, ради которого она существует (решение владельца продукта на скриншот свода
 * «Все петли защищены, тишины нет» два дня подряд): сообщение уходит человеку только
 * тогда, когда в нём есть новость, по которой можно действовать. Всё остальное —
 * состояние, и его место на экране, а не в мессенджере.
 *
 * Отсюда два метода и ни одного третьего пути:
 *  · report() — сторож посчитал картину целиком. Уходит только новое, изменившееся,
 *    закрывшееся и застоявшееся дольше срока напоминания. Пустая картина = тишина.
 *  · alert() — происшествие, о котором человек иначе не узнает (отказ распознавания,
 *    владелец зовёт трекера). Новость по определению, уходит всегда.
 *
 * Живость самих сторожей доказывает отметка о прогоне (watchdog_runs), а не сообщение:
 * её видно в админке, и по ней же кричит сторож сторожей, когда прогон пропал.
 */
@Injectable()
export class StaffNotifierService implements OnModuleInit {
  private readonly logger = new Logger(StaffNotifierService.name);

  constructor(
    @InjectRepository(StaffSignalState) private readonly signalRepo: Repository<StaffSignalState>,
    @InjectRepository(WatchdogRun) private readonly runRepo: Repository<WatchdogRun>,
    private readonly telegram: TelegramService,
  ) {}

  /**
   * Отметка появляется в момент, когда сторож зарегистрирован, а не при первом прогоне.
   * Иначе сторож сторожей молчал бы про механизм, который не запускался НИ РАЗУ, — ровно
   * тот класс дефекта, ради которого он и заведён.
   */
  async onModuleInit(): Promise<void> {
    try {
      for (const w of WATCHDOGS) {
        const existing = await this.runRepo.findOne({ where: { key: w.key } });
        if (!existing) {
          await this.runRepo.save(this.runRepo.create({ key: w.key, lastRunAt: new Date(), lastSignalCount: 0 }));
        }
      }
    } catch (err) {
      // Регистрация сторожей не должна валить старт приложения.
      this.logger.warn(`регистрация сторожей: ${(err as Error).message}`);
    }
  }

  /** Отметка «сторож отработал». Ставится и когда сказать было нечего. */
  async markRun(key: string, signalCount = 0, sent = false): Promise<void> {
    const row =
      (await this.runRepo.findOne({ where: { key } })) ??
      this.runRepo.create({ key, lastRunAt: new Date(), lastSentAt: null, lastSignalCount: 0 });
    row.lastRunAt = new Date();
    row.lastSignalCount = signalCount;
    if (sent) row.lastSentAt = new Date();
    await this.runRepo.save(row);
  }

  /**
   * Свод состояния. Отправляет только то, чего человек ещё не знает.
   * Возвращает разбор решения — он же идёт в лог, чтобы «почему не пришло» имело ответ.
   */
  async report(
    key: string,
    title: string,
    signals: StaffSignal[],
    opts: StaffReportOptions = {},
  ): Promise<StaffReportResult> {
    const repeatAfterDays = opts.repeatAfterDays ?? DEFAULT_REPEAT_DAYS;
    const now = new Date();
    const known = await this.signalRepo.find({ where: { key } });
    const byId = new Map(known.map((s) => [s.signalId, s]));

    const lines: string[] = [];
    const toSave: StaffSignalState[] = [];
    let fresh = 0;
    let changed = 0;
    let repeated = 0;
    let silent = 0;

    for (const sig of signals) {
      const stage = normalizeStage(sig.stage ?? '');
      const prev = byId.get(sig.id);
      byId.delete(sig.id);

      if (!prev) {
        lines.push(sig.text);
        fresh++;
        toSave.push(
          this.signalRepo.create({
            key,
            signalId: sig.id,
            stage,
            text: sig.text,
            firstSeenAt: now,
            lastSentAt: now,
          }),
        );
        continue;
      }

      const standingDays = Math.floor((now.getTime() - new Date(prev.firstSeenAt).getTime()) / DAY_MS);
      const sinceSentDays = (now.getTime() - new Date(prev.lastSentAt).getTime()) / DAY_MS;

      if (prev.stage !== stage) {
        lines.push(sig.text);
        changed++;
      } else if (opts.force || sinceSentDays >= repeatAfterDays) {
        lines.push(standingDays >= 1 ? `${sig.text} · держится ${standingDays} дн.` : sig.text);
        repeated++;
      } else {
        // Молчим, но текст обновляем: следующее напоминание покажет актуальное число.
        prev.text = sig.text;
        toSave.push(prev);
        silent++;
        continue;
      }

      prev.stage = stage;
      prev.text = sig.text;
      prev.lastSentAt = now;
      toSave.push(prev);
    }

    // Осталось в карте = проблема исчезла. Закрытие это новость, но только если проблема
    // прожила хотя бы день: мигание вокруг порога сообщением не является.
    //
    // Из закрытия исключается всё, чьё состояние в этом прогоне не проверялось: упавшая
    // проверка отдаёт УРЕЗАННЫЙ список, и без этого фильтра её молчание превращается в
    // «✅ снято» — сообщение, означающее ровно обратное тому, что произошло.
    const unverified = new Set(opts.unverified ?? []);
    const gone = [...byId.values()].filter((row) => !unverified.has(row.signalId));
    const closedLines = gone
      .filter((row) => now.getTime() - new Date(row.firstSeenAt).getTime() >= MIN_LIFETIME_TO_ANNOUNCE_CLOSE_MS)
      .map((row) => `✅ снято: ${row.text}`);
    lines.push(...closedLines);

    const open = signals.length;
    const base: StaffReportResult = {
      sent: false,
      chats: 0,
      fresh,
      changed,
      repeated,
      closed: closedLines.length,
      silent,
      open,
    };

    if (!lines.length) {
      await this.persist(toSave, gone);
      if (opts.force && opts.emptyText) {
        const { sent: chats } = await this.deliver(`${title}\n\n${opts.emptyText}`);
        await this.markRun(key, open, chats > 0);
        return { ...base, sent: chats > 0, chats };
      }
      await this.markRun(key, open, false);
      this.logger.log(`[${key}] нового нет: открыто ${open}, промолчали по ${silent} — сообщение не отправлено`);
      return base;
    }

    const body = `${title}\n\n${lines.join('\n')}` + (opts.footer ? `\n\n<i>${opts.footer}</i>` : '');
    const { sent: chats, total } = await this.deliver(body);

    // Состояние двигается, когда новость дошла ХОТЯ БЫ ДО ОДНОГО адресата, и не двигается,
    // когда не дошла ни до кого. Промежуточный случай (дошло не всем) лечится НЕ повтором:
    // редакция, требовавшая полной доставки, при навсегда заблокированном втором чате
    // повторяла одно и то же сообщение каждый прогон — то есть возвращала ровно тот
    // ежедневный шум, ради прекращения которого весь этот механизм и написан (проверено
    // тестом 09.09.2026: пять прогонов, пять одинаковых сообщений).
    //
    // Недоставка не теряется молча, у неё свой носитель: мёртвый чат НАШЕЙ стороны видит
    // сторож каналов и поднимает его отдельной строкой как поломку, требующую починки.
    if (chats === 0) {
      await this.markRun(key, open, false);
      this.logger.warn(`[${key}] сообщение не доставлено никому, состояние не двигаем: повторим на следующем прогоне`);
      return { ...base, sent: false, chats: 0 };
    }
    if (chats < total) {
      this.logger.warn(
        `[${key}] доставлено ${chats} из ${total}: часть чатов нашей стороны недоступна, ` +
          `починку поднимет сторож каналов`,
      );
    }

    await this.persist(toSave, gone);
    await this.markRun(key, open, true);
    this.logger.log(
      `[${key}] отправлено в ${chats} чат(ов): новых ${fresh}, изменилось ${changed}, ` +
        `напомнили ${repeated}, снято ${closedLines.length}, промолчали ${silent}`,
    );
    return { ...base, sent: chats > 0, chats };
  }

  /**
   * Происшествие: человек об этом иначе не узнает, и оно требует решения сейчас.
   * Дедупликации нет намеренно — событие уже единично по своей природе, а его повтор
   * гасится тем сторожем, который его породил (отметка о напоминании у него своя).
   */
  async alert(key: string, text: string, button?: { text: string; url: string }): Promise<boolean> {
    const { sent: chats } = await this.deliver(text, button);
    await this.markRun(key, 1, chats > 0);
    return chats > 0;
  }

  /**
   * Адресаты нашей стороны, до которых сообщение физически не доходит.
   *
   * Живёт здесь, а не в стороже каналов, по той же причине, по которой здесь живёт отправка:
   * дверь к нашей стороне одна, и список её адресатов наружу не выдаётся. Сторож каналов
   * спрашивает результат, а не адреса.
   */
  async deadChats(): Promise<string[]> {
    const chats = await this.telegram.staffChatIds();
    const dead: string[] = [];
    for (const chatId of chats) {
      if (!(await this.telegram.isChatAlive(chatId))) dead.push(chatId);
    }
    return dead;
  }

  /** Состояние для админки: когда каждый сторож отработал и что у него открыто. */
  async state(): Promise<{
    watchdogs: {
      key: string;
      label: string;
      lastRunAt: Date | null;
      lastSentAt: Date | null;
      silentHours: number | null;
      overdue: boolean;
      openSignals: { text: string; firstSeenAt: Date; lastSentAt: Date }[];
    }[];
  }> {
    const runs = await this.runRepo.find();
    const signals = await this.signalRepo.find();
    const watchdogs = WATCHDOGS.map((w) => {
      const run = runs.find((r) => r.key === w.key) ?? null;
      const lastRunAt = run?.lastRunAt ?? null;
      const silentHours = lastRunAt ? (Date.now() - new Date(lastRunAt).getTime()) / 3_600_000 : null;
      return {
        key: w.key,
        label: w.label,
        lastRunAt,
        lastSentAt: run?.lastSentAt ?? null,
        silentHours: silentHours === null ? null : Math.round(silentHours),
        overdue: silentHours !== null && silentHours > w.maxSilenceHours,
        openSignals: signals
          .filter((s) => s.key === w.key)
          .sort((a, b) => new Date(a.firstSeenAt).getTime() - new Date(b.firstSeenAt).getTime())
          .map((s) => ({ text: s.text, firstSeenAt: s.firstSeenAt, lastSentAt: s.lastSentAt })),
      };
    });
    return { watchdogs };
  }

  private async persist(toSave: StaffSignalState[], gone: StaffSignalState[]): Promise<void> {
    if (toSave.length) await this.signalRepo.save(toSave);
    if (gone.length) await this.signalRepo.remove(gone);
  }

  /**
   * Возвращает и число доставленных, и число адресатов: только их СРАВНЕНИЕ отвечает на
   * вопрос «дошло ли до всех». Одно число успехов на этот вопрос не отвечает, а решение
   * «считать ли новость рассказанной» принимается именно по нему.
   */
  private async deliver(
    text: string,
    button?: { text: string; url: string },
  ): Promise<{ sent: number; total: number }> {
    const chats = await this.telegram.staffChatIds();
    if (!chats.length) {
      this.logger.warn('нет ни одного чата нашей стороны: сообщение отправить некуда');
      return { sent: 0, total: 0 };
    }
    const sent = await this.telegram.sendToMany(chats, text, button);
    return { sent, total: chats.length };
  }
}
