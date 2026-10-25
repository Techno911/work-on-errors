import { computeCompanyHealth } from './company-health.util';

/**
 * Здоровье компании: главный продукт волны 2. Проверяем не текст ярлыка, а то, ради чего
 * функция написана — что «мы считаем, что работаем, а записей нет» становится выразимым.
 *
 * Функция чистая намеренно: денежный и обещающий расчёт, который нельзя проверить без
 * поднятой базы, на практике остаётся непокрытым и врёт именно он.
 */
const NOW = new Date('2026-08-05T10:00:00Z');

const base = {
  status: 'active' as const,
  startedAt: new Date('2026-04-15T10:00:00Z'),
  lastEntryAt: null,
  submittedLast7d: 0,
  submittedTotal: 0,
  reviewedTotal: 0,
  neverLoggedIn: 0,
  now: NOW,
};

describe('здоровье компании считает система, а не человек', () => {
  it('компания без единой записи это «не начинали», а не «тихо»', () => {
    const h = computeCompanyHealth(base);
    expect(h.state).toBe('not_started');
    // Рабочие дни, а не календарные: 112 календарных с 15 апреля по 5 августа это 80 рабочих.
    expect(h.days).toBe(80);
    expect(h.label).toContain('80');
  });

  it('ручной статус «Активна» при нуле записей даёт расхождение с фактом', () => {
    const h = computeCompanyHealth(base);
    expect(h.mismatch).toBe(true);
    expect(h.mismatchText).toContain('Активна');
  });

  it('давняя последняя запись это тишина с числом дней', () => {
    const h = computeCompanyHealth({ ...base, lastEntryAt: new Date('2026-07-01T10:00:00Z'), submittedTotal: 4, reviewedTotal: 4 });
    expect(h.state).toBe('silent');
    expect(h.days).toBe(25); // 35 календарных = 25 рабочих
    expect(h.mismatch).toBe(true);
  });

  it('первая неделя после запуска это разгон, а не отставание', () => {
    const h = computeCompanyHealth({
      ...base,
      startedAt: new Date('2026-08-01T10:00:00Z'),
      lastEntryAt: new Date('2026-08-04T10:00:00Z'),
      submittedLast7d: 2,
      submittedTotal: 2,
      reviewedTotal: 0,
    });
    expect(h.state).toBe('ramping');
    expect(h.mismatch).toBe(false);
  });

  it('записи идут, а разбора нет — это «отстаёт», и расхождения со статусом нет', () => {
    const h = computeCompanyHealth({
      ...base,
      lastEntryAt: new Date('2026-08-04T10:00:00Z'),
      submittedLast7d: 5,
      submittedTotal: 10,
      reviewedTotal: 1,
    });
    expect(h.state).toBe('lagging');
    expect(h.mismatch).toBe(false);
  });

  it('нормальная работа не поднимает ложную тревогу', () => {
    const h = computeCompanyHealth({
      ...base,
      lastEntryAt: new Date('2026-08-04T10:00:00Z'),
      submittedLast7d: 6,
      submittedTotal: 20,
      reviewedTotal: 18,
    });
    expect(h.state).toBe('running');
    expect(h.mismatch).toBe(false);
    expect(h.mismatchText).toBeNull();
  });

  it('статус «Запуск» неделями без первой записи это тоже расхождение', () => {
    const h = computeCompanyHealth({ ...base, status: 'launch' });
    expect(h.mismatch).toBe(true);
    expect(h.mismatchText).toContain('Запуск');
  });

  it('на паузе идущие записи это расхождение в обратную сторону', () => {
    const h = computeCompanyHealth({
      ...base,
      status: 'paused',
      lastEntryAt: new Date('2026-08-04T10:00:00Z'),
      submittedLast7d: 3,
      submittedTotal: 12,
      reviewedTotal: 12,
    });
    expect(h.mismatch).toBe(true);
    expect(h.mismatchText).toContain('паузе');
  });

  it('закрытая компания без работы тревогой не считается', () => {
    const h = computeCompanyHealth({ ...base, status: 'closed' });
    expect(h.mismatch).toBe(false);
  });

  // Брошенный черновик виден в ЛЮБОМ состоянии: «разгон» с тремя неотправленными записями
  // выглядит как работа, хотя до РОПа не доехало ничего (клиента после перезапуска 06.08.2026).
  it.each([
    ['разгон', { lastEntryAt: new Date('2026-08-08T10:00:00Z'), submittedTotal: 1, reviewedTotal: 1 }],
    ['ни одной сдачи', { lastEntryAt: null, submittedTotal: 0, reviewedTotal: 0 }],
    ['тишина', { lastEntryAt: new Date('2026-07-20T10:00:00Z'), submittedTotal: 4, reviewedTotal: 4 }],
  ])('начатое и неотправленное показывается: %s', (_name, patch) => {
    const h = computeCompanyHealth({ ...base, ...(patch as object), staleDrafts: 3 });
    expect(h.detail).toContain('Начатых и неотправленных записей: 3');
  });

  // Приостановка за неоплату: часы состояния останавливаются на дате закрытия. До 13.08.2026
  // расчёт этого не знал, и клиента числился «работа стоит 8 дней», хотя 3 из них платформа была
  // закрыта нами и сдать запись команда физически не могла.
  // Простой меряется РАБОЧИМИ днями клиента и без дней, когда платформа была закрыта нами
  // (решение владельца продукта «в выходные люди не работают» + разбор клиента 13.08.2026).
  describe('простой считается рабочими днями клиента', () => {
    const quietBase = {
      ...base,
      status: 'active' as const,
      timezone: 'Europe/Moscow',
      submittedLast7d: 0,
      submittedTotal: 4,
      reviewedTotal: 4,
    };

    it('выходные в простой не идут: пятница плюс понедельник это один рабочий день', () => {
      // 07.08.2026 пятница, 10.08.2026 понедельник. Календарь дал бы три дня.
      const h = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-07T09:00:00Z'),
        now: new Date('2026-08-10T09:00:00Z'),
      });
      expect(h.days).toBe(1);
    });

    it('за одни выходные состояние не меняется вовсе', () => {
      const friday = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-07T09:00:00Z'),
        now: new Date('2026-08-08T09:00:00Z'), // суббота
      });
      const sunday = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-07T09:00:00Z'),
        now: new Date('2026-08-09T09:00:00Z'), // воскресенье
      });
      expect(friday.days).toBe(0);
      expect(sunday.days).toBe(0);
    });

    it('дни действующей приостановки из простоя вычтены', () => {
      const open = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-05T06:45:00Z'),
        now: new Date('2026-08-13T10:00:00Z'),
      });
      const held = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-05T06:45:00Z'),
        now: new Date('2026-08-13T10:00:00Z'),
        paymentHold: { from: '2026-08-10T09:15:29.766Z' },
      });
      expect(held.days).toBeLessThan(open.days);
    });

    it('после снятия приостановки её дни не догоняют счётчик', () => {
      // Реальный случай клиента: последняя запись 05.08, закрыто 10.08, открыто 21.08, сегодня 23.08.
      const held = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-05T06:45:00Z'),
        now: new Date('2026-08-23T10:00:00Z'),
        paymentHold: { from: '2026-08-10T09:15:29.766Z', to: '2026-08-21T09:34:16.131Z' },
      });
      const withoutHold = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-05T06:45:00Z'),
        now: new Date('2026-08-23T10:00:00Z'),
      });
      expect(withoutHold.days).toBe(12); // рабочих дней всего
      // Девять рабочих дней приостановки вычтены. День закрытия считается рабочим целиком:
      // спорить о половине дня дороже, чем ошибиться в его пользу.
      expect(held.days).toBe(3);
    });

    it('расхождение статуса с фактом не поднимается, пока доступ закрыт', () => {
      const held = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-05T06:45:00Z'),
        now: new Date('2026-08-13T10:00:00Z'),
        paymentHold: { from: '2026-08-10T09:15:29.766Z' },
      });
      expect(held.mismatch).toBe(false);
    });

    it('в пояснении сказано, что дни приостановки не засчитаны', () => {
      const lifted = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-05T06:45:00Z'),
        now: new Date('2026-08-23T10:00:00Z'),
        paymentHold: { from: '2026-08-10T09:15:29.766Z', to: '2026-08-21T09:34:16.131Z' },
      });
      expect(lifted.detail).toContain('в простой не засчитаны');
    });

    it('состояние подписано рабочими днями, а не календарными', () => {
      const h = computeCompanyHealth({
        ...quietBase,
        lastEntryAt: new Date('2026-08-03T09:00:00Z'),
        now: new Date('2026-08-13T10:00:00Z'),
      });
      expect(h.label).toMatch(/рабочих дней|рабочих дня|рабочий день/);
    });
  });

  it('без брошенных черновиков строка не появляется', () => {
    const h = computeCompanyHealth({ ...base, staleDrafts: 0 });
    expect(h.detail).not.toContain('Начатых и неотправленных');
  });
});
