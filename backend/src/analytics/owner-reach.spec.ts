import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { OwnerReachService } from './owner-reach.service';
import { Company } from '../companies/entities/company.entity';
import { sendReportEmail } from './mailer';

// Живой SMTP в тестах не трогаем: проверяем сам факт и адресатов письма.
jest.mock('./mailer', () => ({ sendReportEmail: jest.fn(async () => undefined) }));
const sendReportEmailMock = sendReportEmail as jest.MockedFunction<typeof sendReportEmail>;

/**
 * Замки доставки сигналов владельцу (разбор швов 09.08.2026).
 *
 * Стерегут класс «мёртвый канал»: сторож работает, лог чистый, а человек не получает
 * ничего, потому что сигнал умеет ровно один вид адреса. Так три сигнала (просрочка ревью,
 * пятничная эскалация долга, невостребованный доступ) не доходили НИ ДО ОДНОГО живого
 * клиента: у одного клиента и клиента заполнена только почта.
 *
 * Замок ставится на ПОВЕРХНОСТЬ (обход всех планировщиков), а не на три файла, где дефект
 * был найден: иначе следующий сторож заведёт себе четвёртую копию правила «куда писать».
 */

const ANALYTICS_DIR = __dirname;

/** Комментарии вырезаются: иначе замок ловит текст, который ОПИСЫВАЕТ дефект. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

function schedulerFiles(): string[] {
  return readdirSync(ANALYTICS_DIR)
    .filter((f) => f.endsWith('.scheduler.ts'))
    .map((f) => join(ANALYTICS_DIR, f))
    .filter((p) => statSync(p).isFile());
}

describe('адрес владельца: один источник для всех сторожей', () => {
  // Кому читать telegramChatIds напрямую законно и почему.
  const ALLOWED_DIRECT = new Set([
    'weekly-report.scheduler.ts', // недельный отчёт: у него свой почтовый путь с самого начала
    'rop-bonus-payout.scheduler.ts', // расчёт премии: тоже пара «почта + чаты»
    'channel-check.scheduler.ts', // сама проверка каналов обязана видеть сырой список
  ]);

  it('срочные сигналы не читают telegramChatIds в обход общего слоя', () => {
    const offenders: string[] = [];
    for (const path of schedulerFiles()) {
      const name = path.split('/').pop() as string;
      if (ALLOWED_DIRECT.has(name)) continue;
      const code = stripComments(readFileSync(path, 'utf8'));
      const hits = code.match(/telegramChatIds/g);
      if (hits) offenders.push(`${name}: ${hits.length}`);
    }
    expect(offenders).toEqual([]);
  });

  it('каждый сигнал владельцу доставляется через OwnerReachService', () => {
    // Считаем ВХОЖДЕНИЯ, а не факт наличия: у сторожа доступов вызов один, у loop-guard свой,
    // и поломка одного из них не должна прятаться за уцелевшим соседом.
    const expected: Record<string, number> = {
      'overdue.scheduler.ts': 1,
      'access-watch.scheduler.ts': 1,
      'loop-guard.scheduler.ts': 1,
    };
    for (const [name, times] of Object.entries(expected)) {
      const code = stripComments(readFileSync(join(ANALYTICS_DIR, name), 'utf8'));
      const calls = code.match(/this\.ownerReach\.deliver\(/g) ?? [];
      expect(`${name}:${calls.length}`).toBe(`${name}:${times}`);
    }
  });
});

describe('OwnerReachService собирает все адреса', () => {
  const company = {
    id: 'c1',
    name: 'Тест',
    reportChannels: { weeklyAccountability: { emails: ['owner@example.invalid'], telegramChatIds: [] } },
  } as unknown as Company;

  function build(opts: {
    personalChatId?: string | null;
    sendResult?: number;
    /** Когда письмо этого вида уходило в прошлый раз (для проверки паузы). */
    lastEmailAt?: Date | null;
  }) {
    const sent: { chats: string[]; text: string }[] = [];
    const mails: { to: string[]; subject: string }[] = [];
    const telegram = {
      findContactByUserId: jest.fn(async () =>
        opts.personalChatId ? { chatId: opts.personalChatId } : null,
      ),
      sendToMany: jest.fn(async (chats: string[], text: string) => {
        sent.push({ chats, text });
        return opts.sendResult ?? chats.length;
      }),
    };
    const userRepo = { find: jest.fn(async () => [{ id: 'owner-1' }]) };
    const events = {
      logDelivery: jest.fn(async () => undefined),
      lastDeliveryAt: jest.fn(async () => opts.lastEmailAt ?? null),
    };
    const service = new OwnerReachService(userRepo as never, telegram as never, events as never);
    return { service, telegram, events, sent, mails };
  }

  it('личная привязка владельца попадает в адреса, даже когда каналы пусты', async () => {
    const { service } = build({ personalChatId: '555' });
    const reach = await service.collect(company);
    expect(reach.chats).toEqual(['555']);
    expect(reach.emails).toEqual(['owner@example.invalid']);
    expect(reach.reachable).toBe(true);
  });

  it('без единого адреса сигнал честно считается недоставленным', async () => {
    const empty = {
      ...company,
      reportChannels: { weeklyAccountability: { emails: [], telegramChatIds: [] } },
    } as unknown as Company;
    const { service } = build({ personalChatId: null });
    const delivery = await service.deliver(empty, {
      kind: 'overdue',
      tgHtml: 'x',
      subject: 's',
      emailHtml: 'h',
    });
    expect(delivery.delivered).toBe(false);
    expect(delivery.chats).toBe(0);
    expect(delivery.emails).toBe(0);
  });

  it('почта работает запасным путём, когда Telegram недоступен', async () => {
    sendReportEmailMock.mockClear();
    const { service } = build({ personalChatId: null });
    const delivery = await service.deliver(company, {
      kind: 'overdue',
      tgHtml: 'x',
      subject: 'тема',
      emailHtml: '<p>тело</p>',
    });
    // Telegram-адресов нет вовсе, значит должен сработать почтовый путь.
    expect(delivery.chats).toBe(0);
    expect(delivery.emails).toBe(1);
    expect(delivery.delivered).toBe(true);
    expect(sendReportEmailMock).toHaveBeenCalledWith(['owner@example.invalid'], 'тема', '<p>тело</p>');
  });

  it('письмо не повторяется, пока не вышла пауза', async () => {
    sendReportEmailMock.mockClear();
    // Сторож просрочки ежедневный: без паузы владелец получал бы письмо каждый день.
    const { service } = build({ personalChatId: null, lastEmailAt: new Date(Date.now() - 86_400_000) });
    const delivery = await service.deliver(company, {
      kind: 'overdue',
      emailCooldownDays: 3,
      tgHtml: 'x',
      subject: 'тема',
      emailHtml: '<p>тело</p>',
    });
    expect(sendReportEmailMock).not.toHaveBeenCalled();
    expect(delivery.emails).toBe(0);
  });

  it('после паузы письмо уходит снова', async () => {
    sendReportEmailMock.mockClear();
    const { service } = build({ personalChatId: null, lastEmailAt: new Date(Date.now() - 5 * 86_400_000) });
    const delivery = await service.deliver(company, {
      kind: 'overdue',
      emailCooldownDays: 3,
      tgHtml: 'x',
      subject: 'тема',
      emailHtml: '<p>тело</p>',
    });
    expect(sendReportEmailMock).toHaveBeenCalled();
    expect(delivery.emails).toBe(1);
  });

  it('каждая доставка попадает в журнал компании', async () => {
    const { service, events } = build({ personalChatId: '555', sendResult: 1 });
    await service.deliver(company, {
      kind: 'overdue',
      tgHtml: 'x',
      subject: 'тема',
      emailHtml: '<p>тело</p>',
    });
    expect(events.logDelivery).toHaveBeenCalledWith(
      'c1', 'telegram_owner', true, 'тема', expect.any(String), 'overdue',
    );
  });

  it('при живом Telegram письмо не дублирует сообщение', async () => {
    sendReportEmailMock.mockClear();
    const { service, telegram } = build({ personalChatId: '555', sendResult: 1 });
    const delivery = await service.deliver(company, {
      kind: 'overdue',
      tgHtml: 'x',
      subject: 'тема',
      emailHtml: '<p>тело</p>',
    });
    expect(telegram.sendToMany).toHaveBeenCalled();
    expect(delivery.chats).toBe(1);
    expect(delivery.emails).toBe(0);
    expect(sendReportEmailMock).not.toHaveBeenCalled();
  });
});
