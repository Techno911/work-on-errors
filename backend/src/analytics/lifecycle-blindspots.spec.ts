import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { LoopGuardScheduler } from './loop-guard.scheduler';
import { StaffNotifierService } from './staff-notifier.service';
import { InMemoryRepo } from './testing/in-memory-repo';

/**
 * Замки на слепые пятна жизненного цикла (разбор швов 09.08.2026).
 *
 * Общий класс у всех проверок ниже: механизм работает, лог чистый, тесты зелёные, а видит
 * он не то. Черновик считается работой; сторож запуска считает историю вместо текущего
 * запуска; свод здоровья не показывает очередь на разбор; тишина «проскакивает» между
 * кратными семи днями. Ни одно из этого не ловится ни типами, ни прежними тестами.
 */

const SRC = join(__dirname, '..');

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function read(rel: string): string {
  return stripComments(readFileSync(join(SRC, rel), 'utf8'));
}

/** Тело метода: от сигнатуры до начала следующего метода, а не по числу символов. */
function methodBody(code: string, signature: string): string {
  const start = code.indexOf(signature);
  if (start < 0) throw new Error(`не найдено: ${signature}`);
  const rest = code.slice(start + signature.length);
  const next = rest.search(/\n {2}(?:private |public |protected )?(?:async )?[a-zA-Z]\w*\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * Свод здоровья на моках: одна активная компания, у которой N записей ждут разбора.
 * Мокаем ровно то, что метод спрашивает у мира, и собираем текст, ушедший адресату.
 */
function buildHealthScheduler(opts: { pendingCount: number; oldestSubmittedAt?: Date }) {
  const sentTexts: string[] = [];
  const company = {
    id: 'c1',
    name: 'Клиент',
    status: 'active',
    onboardingCompleted: true,
    launchedAt: new Date(Date.now() - 30 * 86_400_000),
    reportChannels: { weeklyAccountability: { emails: ['o@example.invalid'], telegramChatIds: [] } },
    ropBonus: { enabled: true },
    reviewNorms: { maxHoursToRespond: 24 },
    timezone: 'Europe/Moscow',
  };
  const oldest = opts.oldestSubmittedAt ?? new Date();

  const entryRepo = {
    // Последняя сданная запись: свежая, чтобы строка тишины не мешала проверке.
    findOne: jest.fn(async () => ({ createdAt: new Date() })),
    find: jest.fn(async () => (opts.pendingCount > 0 ? [{ createdAt: oldest, submittedAt: oldest }] : [])),
    count: jest.fn(async () => opts.pendingCount),
  };
  const companyRepo = { find: jest.fn(async () => [company]) };
  const userRepo = { find: jest.fn(async () => []) };
  const sprintRepo = { findOne: jest.fn(async () => null) };
  const telegram = {
    enabled: true,
    staffChatIds: jest.fn(async () => ['staff-1']),
    sendToMany: jest.fn(async (_chats: string[], text: string) => {
      sentTexts.push(text);
      return 1;
    }),
    findContactByUserId: jest.fn(async () => null),
  };
  const ropBonus = { getMonthStats: jest.fn(async () => ({ onTimePct: null, currentAmount: 0 })) };
  const ownerReach = { deliver: jest.fn(async () => ({ chats: 0, emails: 0, delivered: false })) };

  // Свод отдаётся человеку через StaffNotifierService, поэтому в замке стоит НАСТОЯЩИЙ
  // нотификатор на репозиториях в памяти, а не заглушка: иначе тест перестал бы проверять
  // то, что реально уходит адресату (а именно текст ушедшего здесь и есть предмет проверки).
  const notifier = new StaffNotifierService(
    new InMemoryRepo(['key', 'signalId']) as never,
    new InMemoryRepo(['key']) as never,
    telegram as never,
  );

  const scheduler = new LoopGuardScheduler(
    entryRepo as never,
    companyRepo as never,
    userRepo as never,
    sprintRepo as never,
    telegram as never,
    ropBonus as never,
    ownerReach as never,
    notifier,
  );
  return { scheduler, sentTexts, notifier };
}

describe('черновик не считается работой', () => {
  // Поверхность: все места, где ищется «последняя запись компании» для оценки живости.
  const SURFACES: { file: string; signature: string }[] = [
    { file: 'admin/admin.service.ts', signature: 'const lastEntry = await this.entriesRepo.findOne(' },
    { file: 'dashboard/dashboard.service.ts', signature: 'const lastEntry = await this.entriesRepository.findOne(' },
    { file: 'analytics/loop-guard.scheduler.ts', signature: 'const last = await this.entryRepo.findOne(' },
  ];

  it.each(SURFACES)('$file исключает черновики из последней записи', ({ file, signature }) => {
    const code = read(file);
    const start = code.indexOf(signature);
    expect(start).toBeGreaterThan(-1);
    // Окно берём до конца вызова findOne, а не по числу символов.
    const window = code.slice(start, code.indexOf('})', start) + 2);
    expect(window).toMatch(/Not\(EntryStatus\.DRAFT\)/);
  });
});

describe('сторож запуска считает от старта, а не за всю историю', () => {
  const code = read('analytics/launch.scheduler.ts');
  const body = methodBody(code, 'private async checkCompany(company: Company): Promise<void> {');

  it('разборы считаются с момента запуска', () => {
    expect(body).toMatch(/reviewedAt:\s*MoreThanOrEqual\(since\)/);
  });

  it('записи после запуска считаются с момента запуска и без черновиков', () => {
    expect(body).toMatch(/createdAt:\s*MoreThanOrEqual\(since\)/);
    expect(body).toMatch(/status:\s*Not\(EntryStatus\.DRAFT\)/);
  });

  it('счётчика «за всё время» не осталось', () => {
    // Именно эта конструкция делала сторож слепым на перезапуске.
    expect(body).not.toMatch(/count\(\{\s*where:\s*\{\s*companyId:\s*company\.id\s*\}\s*\}\)/);
  });

  it('автоматический переход статуса попадает в журнал компании', () => {
    expect(body).toMatch(/this\.events\.log\(/);
    expect(body).toMatch(/CompanyEventType\.STATUS_CHANGED/);
  });
});

describe('свод здоровья видит очередь на разбор и держит тишину каждый день', () => {
  const code = read('analytics/loop-guard.scheduler.ts');
  const body = methodBody(code, 'async sendSuperadminHealth(force = false): Promise<boolean> {');

  // Структурная проверка здесь была СЛЕПОЙ: она искала EntryStatus.SUBMITTED и текст строки,
  // а оба остаются в файле, даже когда очередь перестаёт вычисляться. Поймано негативной
  // проверкой (десятая причина слепоты: наличие строки вместо её использования). Поэтому
  // очередь проверяется поведением — по тексту, который реально уходит адресату.
  // Время фиксируем: рабочие часы зависят от дня недели, и тест на «три дня назад» давал бы
  // в понедельник и в субботу разные числа, то есть менялся бы сам собой.
  afterEach(() => jest.useRealTimers());

  it('в собранный свод попадает строка про записи, ждущие разбора', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T09:00:00Z')); // среда, 12:00 Мск
    const { scheduler, sentTexts } = buildHealthScheduler({
      pendingCount: 7,
      oldestSubmittedAt: new Date('2026-08-18T09:00:00Z'), // вторник, 12:00 Мск
    });
    await scheduler.sendSuperadminHealth();
    // Вторник с 12:00 до 18:00 плюс среда с 9:00 до 12:00 = девять рабочих часов.
    expect(sentTexts.join('\n')).toMatch(/7 записей ждут разбора, самая старая 9 рабочих часов из 24/);
  });

  it('просрочка норматива даёт строку даже на одной записи', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-19T09:00:00Z')); // среда
    const { scheduler, sentTexts } = buildHealthScheduler({
      pendingCount: 1,
      oldestSubmittedAt: new Date('2026-08-14T07:00:00Z'), // пятница, 10:00 Мск
    });
    await scheduler.sendSuperadminHealth();
    expect(sentTexts.join('\n')).toMatch(/1 запись ждёт разбора, самая старая \d+ рабочих часов из 24/);
  });

  it('выходные не превращают свежую запись в просрочку', async () => {
    // Ровно случай одного клиента 23.08.2026: сдано в четверг вечером, свод пришёл в воскресенье
    // и написал «самая старая 2 дня», хотя рабочих часов набежало девять из двадцати четырёх.
    jest.useFakeTimers().setSystemTime(new Date('2026-08-23T09:00:00Z')); // воскресенье
    const { scheduler, sentTexts } = buildHealthScheduler({
      pendingCount: 3,
      oldestSubmittedAt: new Date('2026-08-20T14:37:00Z'), // четверг, 17:37 Мск
    });
    await scheduler.sendSuperadminHealth();
    // Три записи внутри норматива это не проблема, поэтому строки нет вовсе. Раньше здесь
    // печаталось «самая старая 2 дня», и это читалось как провал дисциплины РОПа.
    expect(sentTexts.join('\n')).not.toMatch(/ждут разбора|ждёт разбора/);
  });

  it('без очереди строка не появляется', async () => {
    const { scheduler, sentTexts } = buildHealthScheduler({ pendingCount: 0 });
    await scheduler.sendSuperadminHealth();
    expect(sentTexts.join('\n')).not.toMatch(/ждут разбора/);
  });

  it('строка тишины больше не привязана к кратности семи', () => {
    // Раньше: daysQuiet % 7 === 0 — пропущенный день прятал компанию ещё на неделю.
    expect(body).not.toMatch(/daysQuiet\s*%\s*7/);
    expect(body).toMatch(/daysQuiet >= LoopGuardScheduler\.QUIET_WORKDAYS/);
    // И порог, и счёт живут в РАБОЧИХ днях: календарная арифметика по миллисекундам сюда
    // больше не возвращается (решение владельца продукта про выходные).
    expect(body).toMatch(/idleWorkingDays\(company\.timezone, last\.createdAt/);
    expect(body).not.toMatch(/daysQuiet = Math\.floor/);
  });
});

describe('фильтр аудитории применён на всей поверхности сторожей', () => {
  /**
   * Поверхность это ВСЕ планировщики проекта, а не папка analytics. Первая редакция этого
   * замка проверяла два известных файла и дала ложное чувство закрытого класса: недельный
   * отчёт, расчёт премии, еженедельный квиз аттестации и напоминания по методичке остались
   * без фильтра и продолжали адресоваться закрытым и демонстрационным компаниям (09.08.2026,
   * найдено вторым проходом по просьбе владельца «проверь ещё раз»).
   */
  function allSchedulers(): string[] {
    const out: string[] = [];
    for (const dir of readdirSync(SRC, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const f of readdirSync(join(SRC, dir.name))) {
        if (f.endsWith('.scheduler.ts')) out.push(join(dir.name, f));
      }
    }
    return out;
  }

  // Сторожа, которым фильтр не нужен, и ПОЧЕМУ. Список именной: молчаливое исключение
  // и есть тот способ, которым дефект возвращается.
  const NO_FILTER_NEEDED: Record<string, string> = {
    'analytics/launch.scheduler.ts': "выбирает по status: 'launch' в самом запросе",
    'analytics/pause-watch.scheduler.ts': "выбирает по status: 'paused' в самом запросе",
    'crm-integration/crm-staging.scheduler.ts': 'техническая уборка, людям не пишет',
    'transcription/transcription.scheduler.ts': 'дораспознавание записей, людям не пишет',
    'analytics/watchdog-liveness.scheduler.ts': 'следит за прогонами сторожей, компаний не читает вовсе',
  };

  it('каждый сторож либо спрашивает фильтр, либо назван исключением с причиной', () => {
    const offenders: string[] = [];
    for (const rel of allSchedulers()) {
      if (NO_FILTER_NEEDED[rel]) continue;
      const code = read(rel);
      if (!/canSignalClient\(company\)|isUnderOurWatch\(company\)/.test(code)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('исключения не разъехались с кодом: каждое всё ещё существует', () => {
    const existing = new Set(allSchedulers());
    for (const rel of Object.keys(NO_FILTER_NEEDED)) {
      expect(`${rel}: ${existing.has(rel)}`).toBe(`${rel}: true`);
    }
  });

  it('ни один сторож не проверяет статусы вручную в обход общей утилиты', () => {
    const offenders: string[] = [];
    for (const rel of allSchedulers()) {
      const code = read(rel);
      const manual = code.match(/status === 'closed'|status === 'demo'/g);
      if (manual) offenders.push(`${rel}: ${manual.length}`);
    }
    expect(offenders).toEqual([]);
  });
});
