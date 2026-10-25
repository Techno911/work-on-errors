import { activeDaysCount } from './company-time.util';

/**
 * «Дней активности» отличает 10 записей за 4 дня от 10 записей в четверг вечером.
 * Считается по локальному времени компании, поэтому главный риск — граница суток:
 * в UTC ещё вчера, а в Красноярске уже завтра. Тест держит именно это.
 */
describe('activeDaysCount', () => {
  it('одна запись — один день', () => {
    expect(activeDaysCount('Europe/Moscow', [new Date('2026-07-14T10:00:00Z')])).toBe(1);
  });

  it('несколько записей в один день считаются одним днём', () => {
    expect(activeDaysCount('Europe/Moscow', [
      new Date('2026-07-14T06:00:00Z'),
      new Date('2026-07-14T12:00:00Z'),
      new Date('2026-07-14T18:00:00Z'),
    ])).toBe(1);
  });

  it('записи в разные дни считаются раздельно', () => {
    expect(activeDaysCount('Europe/Moscow', [
      new Date('2026-07-13T10:00:00Z'),
      new Date('2026-07-14T10:00:00Z'),
      new Date('2026-07-15T10:00:00Z'),
    ])).toBe(3);
  });

  it('граница суток считается по таймзоне компании, а не по UTC', () => {
    // Обе метки — 14 июля по UTC, но в Москве (UTC+3) вторая уже 15-е, 00:30.
    const evening = new Date('2026-07-14T20:30:00Z'); // мск 23:30, 14 июля
    const afterMidnight = new Date('2026-07-14T21:30:00Z'); // мск 00:30, 15 июля
    expect(activeDaysCount('Europe/Moscow', [evening, afterMidnight])).toBe(2);
    expect(activeDaysCount('UTC', [evening, afterMidnight])).toBe(1);
  });

  it('пустой список и мусорные значения не ломают счёт', () => {
    expect(activeDaysCount('Europe/Moscow', [])).toBe(0);
    expect(activeDaysCount('Europe/Moscow', [null, undefined, new Date('нет такой даты')])).toBe(0);
  });

  it('принимает строковые даты (так они приходят из jsonb и API)', () => {
    expect(activeDaysCount('Europe/Moscow', ['2026-07-13T10:00:00Z', '2026-07-14T10:00:00Z'])).toBe(2);
  });

  it('неизвестная таймзона не роняет расчёт', () => {
    expect(activeDaysCount('Нет/Такой', [new Date('2026-07-14T10:00:00Z')])).toBe(1);
  });
});
