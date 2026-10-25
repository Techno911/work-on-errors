import { ForbiddenException } from '@nestjs/common';
import { PaymentHoldInterceptor } from './payment-hold.interceptor';
import * as fs from 'fs';
import { join } from 'path';
import { HttpExceptionFilter } from '../filters/http-exception.filter';
import { UserRole } from '../../users/enums/user-role.enum';
import { canSignalClient, isUnderOurWatch } from '../../companies/signal-audience.util';
import type { Company } from '../../companies/entities/company.entity';

/**
 * Замки приостановки за неоплату (10.08.2026).
 *
 * Что они стерегут. Экран приостановки во фронте это вежливость: обещание «дальше никуда не
 * продвинуться» держит только сервер. Проверка живёт глобально, а не в контроллерах, поэтому
 * сломать её можно двумя способами, и оба тихие: расширить белый список путей (и открыть
 * работу целиком) либо начать считать отсутствие поля за «не приостановлена».
 *
 * Каждая проверка сломана негативно перед тем, как её оставить зелёной.
 */

type Ctx = { url: string; user: unknown };

function contextOf({ url, user }: Ctx) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ url, user }) }),
  } as never;
}

/** Ручка следующего шага: вызвана значит запрос пропущен дальше. */
function nextHandler() {
  const calls = { count: 0 };
  return {
    calls,
    handler: { handle: () => { calls.count += 1; return 'passed' as never; } } as never,
  };
}

/** Пропущен ли запрос дальше (в терминах интерцептора это вызов next.handle()). */
async function passes(interceptor: PaymentHoldInterceptor, ctx: unknown): Promise<boolean> {
  const { calls, handler } = nextHandler();
  await interceptor.intercept(ctx as never, handler);
  return calls.count === 1;
}

function guardWith(companyInDb: { paymentHold: boolean } | null) {
  const repo = {
    findOne: jest.fn().mockResolvedValue(companyInDb),
  };
  return { guard: new PaymentHoldInterceptor(repo as never), repo };
}

const teamUser = (role: UserRole, company?: { paymentHold: boolean }) => ({
  id: 'u1',
  role,
  companyId: 'c1',
  company: company ? { id: 'c1', ...company } : undefined,
});

describe('приостановка за неоплату: кого закрывает сервер', () => {
  it.each([UserRole.OWNER, UserRole.REVIEWER, UserRole.MANAGER])(
    'команда клиента (%s) получает отказ с кодом PAYMENT_HOLD',
    async role => {
      const { guard } = guardWith({ paymentHold: true });
      await expect(
        passes(guard, contextOf({ url: '/api/entries', user: teamUser(role, { paymentHold: true }) })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  /**
   * Признак отказа обязан пережить глобальный фильтр исключений: тот пересобирает тело ответа
   * и оставляет только statusCode, message и error. Собственное поле code до фронта не дошло
   * бы вовсе, и экран приостановки не поднимался бы по отказу сервера. Проверяем не намерение
   * в guard, а то, что реально уходит в браузер.
   */
  it('признак PAYMENT_HOLD доезжает до фронта через фильтр исключений', async () => {
    const { guard } = guardWith({ paymentHold: true });
    let thrown: unknown;
    try {
      await passes(guard,
        contextOf({ url: '/api/entries', user: teamUser(UserRole.MANAGER, { paymentHold: true }) }),
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);

    // Прогоняем отказ через боевой фильтр и смотрим на итоговое тело ответа.
    const sent: Record<string, unknown>[] = [];
    const response = { status: () => response, json: (b: Record<string, unknown>) => sent.push(b) };
    new HttpExceptionFilter().catch(thrown, {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ method: 'GET', url: '/api/entries', headers: {} }),
      }),
    } as never);

    expect(sent).toHaveLength(1);
    const asJson = JSON.stringify(sent[0]);
    expect(asJson).toContain('PAYMENT_HOLD');
  });

  it.each([UserRole.SUPERADMIN, UserRole.TRACKER])(
    'наши роли (%s) работают: иначе снять приостановку будет некому',
    async role => {
      const { guard } = guardWith({ paymentHold: true });
      const user = { id: 'a1', role, companyId: null, company: undefined };
      await expect(
        passes(guard, contextOf({ url: '/api/admin/companies', user })),
      ).resolves.toBe(true);
    },
  );

  it('публичный путь без пользователя не трогается (оферта, ссылка на разбор, вебхук)', async () => {
    const { guard } = guardWith({ paymentHold: true });
    await expect(passes(guard, contextOf({ url: '/api/share/abc', user: undefined }))).resolves.toBe(true);
  });

  it('снятая приостановка открывает работу тем же запросом', async () => {
    const { guard } = guardWith({ paymentHold: false });
    await expect(
      passes(guard, contextOf({ url: '/api/entries', user: teamUser(UserRole.MANAGER, { paymentHold: false }) })),
    ).resolves.toBe(true);
  });
});

describe('что остаётся открытым при приостановке', () => {
  const openPaths = [
    '/api/auth/login',
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/companies/access-state',
    '/api/health',
  ];

  it.each(openPaths)('%s открыт: без него человек не увидит объяснения и не выйдет', async url => {
    const { guard } = guardWith({ paymentHold: true });
    await expect(
      passes(guard, contextOf({ url, user: teamUser(UserRole.OWNER, { paymentHold: true }) })),
    ).resolves.toBe(true);
  });

  it.each([
    '/api/entries',
    '/api/sprints/current',
    '/api/analytics/team',
    '/api/playbook/cards',
    '/api/attestation/attempts',
    '/api/notifications',
    '/api/users',
    '/api/companies/c1',
    '/api/gamification/me',
  ])('%s закрыт: работа платформы при неоплате не идёт', async url => {
    const { guard } = guardWith({ paymentHold: true });
    await expect(
      passes(guard, contextOf({ url, user: teamUser(UserRole.MANAGER, { paymentHold: true }) })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('похожий путь не проходит по началу строки: /api/health-report закрыт', async () => {
    const { guard } = guardWith({ paymentHold: true });
    await expect(
      passes(guard, contextOf({ url: '/api/health-report', user: teamUser(UserRole.OWNER, { paymentHold: true }) })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('параметры в адресе не открывают закрытый путь', async () => {
    const { guard } = guardWith({ paymentHold: true });
    await expect(
      passes(guard, contextOf({ url: '/api/entries?sprintId=1', user: teamUser(UserRole.MANAGER, { paymentHold: true }) })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('отсутствие поля означает «не знаю», а не «не приостановлена»', () => {
  it('компания не подгружена в сессии: состояние спрашивается у базы', async () => {
    const { guard, repo } = guardWith({ paymentHold: true });
    const user = { id: 'u1', role: UserRole.MANAGER, companyId: 'c1', company: undefined };
    await expect(passes(guard, contextOf({ url: '/api/entries', user }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.findOne).toHaveBeenCalled();
  });

  it('компании нет в базе: работу не закрываем, но и не падаем', async () => {
    const { guard } = guardWith(null);
    const user = { id: 'u1', role: UserRole.MANAGER, companyId: 'c1', company: undefined };
    await expect(passes(guard, contextOf({ url: '/api/entries', user }))).resolves.toBe(true);
  });

  it('известное состояние не порождает лишнего запроса к базе', async () => {
    const { guard, repo } = guardWith({ paymentHold: true });
    await expect(
      passes(guard, contextOf({ url: '/api/entries', user: teamUser(UserRole.MANAGER, { paymentHold: false }) })),
    ).resolves.toBe(true);
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});

/**
 * Самый дорогой дефект этой правки: механизм стоял правильным кодом не на том слое.
 *
 * Глобальные guard'ы Nest отрабатывают РАНЬШЕ контроллерных, то есть до JwtAuthGuard: на этот
 * момент пользователя в запросе нет, замок считает запрос публичным и пропускает всё. Тесты
 * выше этого не видят вовсе, потому что пользователя в них подставляю я сам. Дефект нашёлся
 * только запросом к живому проду, поэтому здесь стоит структурная проверка: она не даст
 * вернуть регистрацию через APP_GUARD ни следующей сессии, ни мне самому.
 */
describe('механизм стоит на слое, где пользователь уже определён', () => {
  const appModule = fs
    .readFileSync(join(__dirname, '..', '..', 'app.module.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');

  it('зарегистрирован как APP_INTERCEPTOR', () => {
    expect(appModule).toMatch(/APP_INTERCEPTOR,\s*useClass:\s*PaymentHoldInterceptor/);
  });

  it('не зарегистрирован как APP_GUARD: там он пропускал бы всех', () => {
    expect(appModule).not.toMatch(/APP_GUARD,\s*useClass:\s*PaymentHold/);
  });
});

describe('сигналы при приостановке', () => {
  const company = (over: Partial<Company>) =>
    ({ status: 'active', paymentHold: false, ...over }) as Company;

  it('команде клиента не пишем: требовать работы от закрытой платформы нельзя', () => {
    expect(canSignalClient(company({ paymentHold: true }))).toBe(false);
  });

  it('из нашего наблюдения компания не выпадает: иначе она станет невидимой', () => {
    expect(isUnderOurWatch(company({ paymentHold: true }))).toBe(true);
  });

  it('без приостановки сигналы идут как прежде', () => {
    expect(canSignalClient(company({}))).toBe(true);
  });
});
