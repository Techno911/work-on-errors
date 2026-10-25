import * as fs from 'fs';
import { join } from 'path';
import { CrmIntegrationService } from './crm-integration.service';

/**
 * Подсказка «подключите CRM» команде клиента (10.08.2026, разбор одного клиента).
 *
 * Класс дефекта, который она закрывает: у клиента есть amoCRM, а команда девятнадцать раз
 * подряд носила звонки файлами. Подключение никто не запрещал, о нём забыли после онбординга,
 * и платформа молчала, потому что «не подключено по решению» и «не подключено по забывчивости»
 * выглядели одинаково.
 *
 * Класс дефекта, который стережёт этот замок: обратная правка «чтобы не шумело». Подсказка
 * обязана молчать в четырёх случаях и говорить в пятом, и оба конца проверяются здесь.
 */

function sourceWithoutComments(relPath: string): string {
  return fs.readFileSync(join(__dirname, '..', relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

type Overrides = Partial<{
  crmNotApplicable: boolean;
  crmHintSnoozedUntil: Date | null;
  transcriptionEnabled: boolean;
  workStartedAt: Date | null;
  connectionStatus: string | null;
}>;

function makeService(o: Overrides = {}) {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  const company = {
    id: 'c1',
    crmNotApplicable: o.crmNotApplicable ?? false,
    crmHintSnoozedUntil: o.crmHintSnoozedUntil ?? null,
    transcription: { enabled: o.transcriptionEnabled ?? true },
    workStartedAt: o.workStartedAt === undefined ? daysAgo(30) : o.workStartedAt,
    launchedAt: null,
    crmHelpRequestedAt: null,
  };
  const conn = o.connectionStatus ? { status: o.connectionStatus } : null;

  // Репозитории приватные, поэтому подставляем их через индексную запись: тест проверяет
  // ЛОГИКУ показа, а поднимать ради неё контейнер Nest и базу незачем.
  const svc = Object.create(CrmIntegrationService.prototype) as Record<string, unknown>;
  svc.companyRepo = { findOne: async () => company, update: async () => ({}) };
  svc.connRepo = { findOne: async () => conn };
  svc.entryRepo = { count: async () => 19 };
  return svc as unknown as CrmIntegrationService;
}

const user = { id: 'u1', companyId: 'c1' } as never;

describe('подсказка о подключении CRM', () => {
  it('приходит работающей команде без подключения: случай одного клиента', async () => {
    const hint = await makeService().myCrmHint(user);
    expect(hint.show).toBe(true);
    expect(hint.manualCalls).toBe(19);
  });

  it('молчит, когда наша команда отметила «подключать нечем»', async () => {
    expect((await makeService({ crmNotApplicable: true }).myCrmHint(user)).show).toBe(false);
  });

  it('молчит, пока руководитель отложил её', async () => {
    const later = new Date(Date.now() + 3 * 86_400_000);
    expect((await makeService({ crmHintSnoozedUntil: later }).myCrmHint(user)).show).toBe(false);
  });

  it('возвращается, когда срок откладывания истёк', async () => {
    const past = new Date(Date.now() - 86_400_000);
    expect((await makeService({ crmHintSnoozedUntil: past }).myCrmHint(user)).show).toBe(true);
  });

  it('молчит при уже подключённой CRM', async () => {
    expect((await makeService({ connectionStatus: 'ok' }).myCrmHint(user)).show).toBe(false);
  });

  it('говорит, если подключение сломано: чинить его тоже нужно', async () => {
    expect((await makeService({ connectionStatus: 'error' }).myCrmHint(user)).show).toBe(true);
  });

  it('молчит без распознавания звонков: импорт из CRM без него бессмыслен', async () => {
    expect((await makeService({ transcriptionEnabled: false }).myCrmHint(user)).show).toBe(false);
  });

  it('молчит в первые дни работы и у команды, которая ещё не начала', async () => {
    const twoDays = new Date(Date.now() - 2 * 86_400_000);
    expect((await makeService({ workStartedAt: twoDays }).myCrmHint(user)).show).toBe(false);
    expect((await makeService({ workStartedAt: null }).myCrmHint(user)).show).toBe(false);
  });
});

describe('структура: отметку «нечем подключать» нельзя поставить молча', () => {
  it('причина обязательна', () => {
    const code = sourceWithoutComments('admin/admin.service.ts');
    const start = code.indexOf('async setCrmNotApplicable');
    expect(start).toBeGreaterThan(-1);
    const rest = code.slice(start);
    const end = rest.search(/\n  (?:private |public |async )?[a-zA-Z]\w*\(/);
    const body = end > 0 ? rest.slice(0, end) : rest;
    expect(body).toMatch(/BadRequestException/);
    expect(body).toMatch(/events\.log/);
  });
});
