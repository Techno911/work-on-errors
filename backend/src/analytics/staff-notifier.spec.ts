import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { StaffNotifierService, StaffSignal, WATCHDOGS, normalizeStage } from './staff-notifier.service';
import { WatchdogLivenessScheduler } from './watchdog-liveness.scheduler';
import { InMemoryRepo } from './testing/in-memory-repo';

/**
 * Замок на правило, которого не было до 03.09.2026: сообщение уходит человеку только когда
 * в нём есть новость. Повод — скриншот владельца с двумя одинаковыми сводами подряд («Все петли
 * защищены, тишины нет») и директива «не надо мне такое присылать, системный фикс».
 *
 * Проверяем ПОВЕДЕНИЕ между прогонами (одного прогона тут мало: молчание зависит от того,
 * что было сказано вчера) и СТРУКТУРУ (второй двери к нам не появилось).
 */

const SRC = join(__dirname, '..');

function makeNotifier() {
  const sent: string[] = [];
  const telegram = {
    enabled: true,
    staffChatIds: jest.fn(async () => ['staff-1']),
    sendToMany: jest.fn(async (_chats: string[], text: string) => {
      sent.push(text);
      return 1;
    }),
  };
  const signalRepo = new InMemoryRepo<Record<string, unknown>>(['key', 'signalId']);
  const runRepo = new InMemoryRepo<Record<string, unknown>>(['key']);
  const notifier = new StaffNotifierService(signalRepo as never, runRepo as never, telegram as never);
  return { notifier, sent, telegram, signalRepo, runRepo };
}

const quiet = (days: number): StaffSignal[] => [
  { id: 'quiet:c1', stage: `w${Math.floor(days / 5)}`, text: `🌑 Клиент: ${days} рабочих дней без новых записей` },
];

describe('свод не будит человека, когда новостей нет', () => {
  afterEach(() => jest.useRealTimers());

  it('пустая картина не отправляет ничего, но отметку о прогоне ставит', async () => {
    const { notifier, sent, runRepo } = makeNotifier();
    const res = await notifier.report('loop-health', 'Здоровье', []);
    expect(sent).toEqual([]);
    expect(res.sent).toBe(false);
    // Живость доказывает отметка, а не сообщение: ровно это и заменило ежедневное «всё чисто».
    expect(runRepo.rows).toHaveLength(1);
    expect(runRepo.rows[0].key).toBe('loop-health');
  });

  it('вчерашняя картина без изменений уходит один раз, а не каждый день', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    await notifier.report('loop-health', 'Здоровье', quiet(6));
    expect(sent).toHaveLength(1);

    for (const day of ['09-02', '09-03', '09-04']) {
      jest.setSystemTime(new Date(`2026-${day}T09:00:00Z`));
      await notifier.report('loop-health', 'Здоровье', quiet(6));
    }
    expect(sent).toHaveLength(1);
  });

  it('ухудшение (смена ступени) это новость', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    await notifier.report('loop-health', 'Здоровье', quiet(6));
    jest.setSystemTime(new Date('2026-09-08T09:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', quiet(11)); // вторая рабочая неделя молчания
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('11 рабочих дней');
  });

  it('новая проблема поднимает сообщение, даже если старая молчит', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    await notifier.report('loop-health', 'Здоровье', quiet(6));
    jest.setSystemTime(new Date('2026-09-02T09:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', [
      ...quiet(7),
      { id: 'hold:c2', stage: 'w0', text: '💳 Второй: доступ закрыт за неоплату' },
    ]);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('доступ закрыт');
    // В сообщении о новой проблеме нет строки о старой: человек её уже читал.
    expect(sent[1]).not.toContain('без новых записей');
  });

  it('проблема, прожившая больше суток и исчезнувшая, отмечается снятой', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    await notifier.report('loop-health', 'Здоровье', quiet(6));
    jest.setSystemTime(new Date('2026-09-03T09:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', []);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('✅ снято');
  });

  it('мигание вокруг порога в тот же день сообщением не является', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    await notifier.report('loop-health', 'Здоровье', [
      { id: 'queue:c1', stage: 'growing', text: '📝 Клиент: 5 записей ждут разбора' },
    ]);
    jest.setSystemTime(new Date('2026-09-01T15:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', []);
    expect(sent).toHaveLength(1);
  });

  it('застоявшаяся проблема напоминает о себе по сроку, а не ежедневно', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    const signals: StaffSignal[] = [{ id: 'noTg:u1', text: '✉️ РОП не подключил Telegram' }];
    await notifier.report('loop-health', 'Здоровье', signals, { repeatAfterDays: 14 });
    for (let day = 2; day <= 14; day++) {
      jest.setSystemTime(new Date(`2026-09-${String(day).padStart(2, '0')}T09:00:00Z`));
      await notifier.report('loop-health', 'Здоровье', signals, { repeatAfterDays: 14 });
    }
    expect(sent).toHaveLength(1);
    jest.setSystemTime(new Date('2026-09-16T09:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', signals, { repeatAfterDays: 14 });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('держится 15 дн.');
  });

  it('ручной прогон человека отдаёт картину целиком, включая «всё чисто»', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    await notifier.report('loop-health', 'Здоровье', quiet(6));
    jest.setSystemTime(new Date('2026-09-02T09:00:00Z'));
    // Тот же набор: автоматический прогон промолчал бы, ручной обязан ответить.
    await notifier.report('loop-health', 'Здоровье', quiet(6), { force: true });
    expect(sent).toHaveLength(2);

    // Чистая картина на ручном прогоне: человек нажал кнопку и обязан получить ответ.
    // Отдельный нотификатор намеренно: если проблема БЫЛА и исчезла, новостью будет «снято»,
    // а не «всё чисто», и это проверяет соседний тест.
    const clean = makeNotifier();
    await clean.notifier.report('loop-health', 'Здоровье', [], { force: true, emptyText: 'Всё чисто.' });
    expect(clean.sent).toHaveLength(1);
    expect(clean.sent[0]).toContain('Всё чисто.');
  });

  it('происшествие уходит всегда: у alert дедупликации нет', async () => {
    const { notifier, sent } = makeNotifier();
    await notifier.alert('stt-error', 'отказ распознавания');
    await notifier.alert('stt-error', 'отказ распознавания');
    expect(sent).toHaveLength(2);
  });

  it('длинная ступень не роняет прогон и не схлопывает разные составы', async () => {
    // Состав не вошедших людей из двух uuid это 73 символа при колонке в 64: без нормализации
    // вставка упала бы и человек не получил бы НИЧЕГО. Обрезка здесь тоже негодна — два
    // состава с общим началом стали бы одной ступенью, и ухудшение перестало бы быть новостью.
    // Различаются ТОЛЬКО последним символом, то есть за пределами ширины колонки: обрезка
    // схлопнула бы их в одну ступень, и замена человека перестала бы быть новостью.
    const a = '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222';
    const b = '11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222229';
    expect(a.slice(0, 64)).toBe(b.slice(0, 64));
    expect(normalizeStage(a).length).toBeLessThanOrEqual(64);
    expect(normalizeStage(a)).not.toBe(normalizeStage(b));
    expect(normalizeStage('overdue:1')).toBe('overdue:1');

    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    const sig = (stage: string): StaffSignal[] => [{ id: 'access:c1', stage, text: '🔑 доступ выдан, входа нет' }];
    await notifier.report('loop-health', 'Здоровье', sig(a));
    jest.setSystemTime(new Date('2026-09-02T09:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', sig(a));
    expect(sent).toHaveLength(1);
    jest.setSystemTime(new Date('2026-09-03T09:00:00Z'));
    await notifier.report('loop-health', 'Здоровье', sig(b));
    expect(sent).toHaveLength(2);
  });

  it('навсегда недоступный адресат не превращает свод в ежедневный повтор', async () => {
    // Требование полной доставки выглядело честнее, а на деле возвращало тот самый шум,
    // ради прекращения которого механизм и написан: заблокировавший бота трекер заставлял
    // повторять одно сообщение каждый прогон. Новость рассказана, если дошла хотя бы до
    // одного; про недоставку человеку говорит сторож каналов отдельной строкой.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent, telegram } = makeNotifier();
    telegram.staffChatIds.mockResolvedValue(['артём', 'трекер-заблокировал-бота']);
    telegram.sendToMany.mockImplementation(async (_c: string[], text: string) => {
      sent.push(text);
      return 1;
    });
    for (let d = 1; d <= 5; d++) {
      jest.setSystemTime(new Date(`2026-09-0${d}T09:00:00Z`));
      await notifier.report('loop-health', 'Здоровье', quiet(6));
    }
    expect(sent).toHaveLength(1);
  });

  it('когда не дошло НИ ДО КОГО, новость остаётся нерассказанной', async () => {
    const { notifier, sent, telegram } = makeNotifier();
    telegram.sendToMany.mockResolvedValueOnce(0);
    const res = await notifier.report('loop-health', 'Здоровье', quiet(6));
    expect(res.sent).toBe(false);
    await notifier.report('loop-health', 'Здоровье', quiet(6));
    expect(sent).toHaveLength(1);
  });

  it('мёртвый чат нашей стороны становится видимой поломкой, а не тишиной', () => {
    // Носитель для недоставки: сторож каналов проверяет НАШИ чаты так же, как клиентские.
    const code = readFileSync(join(SRC, 'analytics/channel-check.scheduler.ts'), 'utf8');
    // Адреса нашей стороны сторож не берёт: он спрашивает у единой двери результат.
    expect(code).toMatch(/notifier\.deadChats\(\)/);
    expect(code).not.toMatch(/staffChatIds\(/);
    expect(code).toMatch(/staffchat:\$\{chatId\}/);
  });

  it('непроверенное не объявляется снятым', async () => {
    // Упавшая проверка отдаёт УРЕЗАННЫЙ список. Без пометки её молчание печаталось бы как
    // «✅ снято», то есть человек получал бы подтверждение починки там, где проверки не было.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { notifier, sent } = makeNotifier();
    const broken: StaffSignal[] = [{ id: 'channel:c1', stage: 'чат не отвечает', text: '🔌 Клиент: чат не отвечает' }];
    await notifier.report('channel-check', 'Каналы', broken);
    expect(sent).toHaveLength(1);

    jest.setSystemTime(new Date('2026-09-08T09:00:00Z'));
    const res = await notifier.report('channel-check', 'Каналы', [], { unverified: ['channel:c1'] });
    expect(sent).toHaveLength(1);
    expect(res.closed).toBe(0);

    // И проблема осталась открытой: когда проверка снова отработает и увидит её, это не будет
    // «новой» проблемой, а когда увидит её отсутствие — честно скажет «снято».
    jest.setSystemTime(new Date('2026-09-09T09:00:00Z'));
    await notifier.report('channel-check', 'Каналы', []);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('✅ снято');
  });

  it('недоставленная новость не считается рассказанной и уходит на следующем прогоне', async () => {
    // Класс «мёртвый канал неотличим от тишины»: если пометить проблему сказанной при
    // неудачной отправке, следующий прогон промолчит о ней навсегда.
    const { notifier, sent, telegram } = makeNotifier();
    telegram.staffChatIds.mockResolvedValueOnce([]);
    const res = await notifier.report('loop-health', 'Здоровье', quiet(6));
    expect(res.sent).toBe(false);
    expect(res.chats).toBe(0);
    expect(sent).toEqual([]);

    await notifier.report('loop-health', 'Здоровье', quiet(6));
    expect(sent).toHaveLength(1);
  });
});

describe('сторож сторожей заменяет ежедневное «всё хорошо»', () => {
  afterEach(() => jest.useRealTimers());

  function build(lastRunHoursAgo: Record<string, number>) {
    const { notifier, sent, runRepo } = makeNotifier();
    for (const w of WATCHDOGS) {
      const hours = lastRunHoursAgo[w.key] ?? 0;
      runRepo.rows.push({ key: w.key, lastRunAt: new Date(Date.now() - hours * 3_600_000), lastSignalCount: 0 });
    }
    const scheduler = new WatchdogLivenessScheduler(runRepo as never, notifier);
    return { scheduler, sent, runRepo };
  }

  it('пока сторожа отчитываются, человек не получает ничего', async () => {
    const { scheduler, sent } = build({});
    await scheduler.run();
    expect(sent).toEqual([]);
  });

  it('замолчавший сторож поднимает тревогу — вот это и есть новость', async () => {
    const { scheduler, sent } = build({ 'loop-health': 200 });
    await scheduler.run();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('свод здоровья петель');
    expect(sent[0]).toContain('не отчитывался');
  });

  it('тревога о том же молчании не повторяется каждый час', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-01T09:00:00Z'));
    const { scheduler, sent, runRepo } = build({ 'loop-health': 200 });
    await scheduler.run();
    for (let h = 1; h <= 6; h++) {
      jest.setSystemTime(new Date(`2026-09-01T${String(9 + h).padStart(2, '0')}:00:00Z`));
      // Остальные сторожа продолжают отчитываться: проверяем повтор тревоги, а не их простой.
      for (const row of runRepo.rows) {
        if (row.key !== 'loop-health') row.lastRunAt = new Date();
      }
      await scheduler.run();
    }
    expect(sent).toHaveLength(1);
  });
});

describe('свод отдаёт полную картину на каждом прогоне', () => {
  /**
   * Условие, которое вычисляется через раз, при дедупликации МИГАЕТ: в один день сигнал
   * исчезает из картины и читается как «снято», в другой появляется снова как новый.
   * Так вело себя понедельничное «РОП не подключил Telegram», и вместо одного сообщения
   * в неделю вышло бы два (найдено на себе 03.09.2026, до выката). Ритм напоминаний держит
   * StaffNotifierService, сторож обязан отдавать ему всё, что верно СЕГОДНЯ.
   */
  it('сбор строк свода не ветвится по дню недели', () => {
    const code = readFileSync(join(SRC, 'analytics/loop-guard.scheduler.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    const start = code.indexOf('async sendSuperadminHealth(');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('\n  }', start));
    expect(body).not.toMatch(/getDay\(\)|isMonday|isoWeekday/);
  });
});

describe('второй двери к нашей стороне нет', () => {
  /**
   * Структурный замок. Пока адрес нашей стороны можно взять напрямую, любой следующий
   * сторож напишет владельцу мимо правила «только новость» — ровно так и появился ежедневный
   * свод «всё чисто». Дверь одна: StaffNotifierService.
   */
  const ALLOWED = ['analytics/telegram.service.ts', 'analytics/staff-notifier.service.ts'];

  function allSources(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) allSources(full, acc);
      else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) acc.push(full);
    }
    return acc;
  }

  it('об одной проблеме не пишут два сторожа сразу', () => {
    // Невостребованный доступ печатала строка свода `access:<компания>` И отдельный alert
    // сторожа доступов: два сообщения об одном факте в одну ночь. Сообщение нашей стороне
    // об этом классе остаётся ровно одно, за сводом.
    const code = readFileSync(join(SRC, 'analytics/access-watch.scheduler.ts'), 'utf8');
    expect(code).not.toMatch(/notifier\.alert\(/);
    const health = readFileSync(join(SRC, 'analytics/loop-guard.scheduler.ts'), 'utf8');
    expect(health).toMatch(/id: `access:\$\{company\.id\}`/);
  });

  it('staffChatIds() зовут только сам транспорт и единая дверь', () => {
    const offenders = allSources(SRC)
      .filter((f) => /staffChatIds\s*\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1))
      .filter((rel) => !ALLOWED.includes(rel));
    expect(offenders).toEqual([]);
  });

  it('у каждого разрешённого файла проверено, что он существует', () => {
    // Иначе замок молча ослабнет при переименовании: список исключений станет мёртвым.
    for (const rel of ALLOWED) expect(() => readFileSync(join(SRC, rel), 'utf8')).not.toThrow();
  });
});
