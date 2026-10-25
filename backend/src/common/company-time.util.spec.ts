import { monthBoundsMs, tzOffsetMs, weekBoundsFor, localParts } from './company-time.util';

// Регресс-сетка на CALC10: границы месяца/недели считаются по ЛОКАЛЬНОЙ дате компании,
// не по UTC сервера. Камчатка/Владивосток/Магадан живут на 9–12 часов впереди UTC —
// последние часы месяца по UTC уже относятся к следующему месяцу компании.
describe('company-time.util', () => {
  describe('tzOffsetMs', () => {
    it('Москва — UTC+3, без перехода на летнее время', () => {
      const at = new Date('2026-06-15T12:00:00Z');
      expect(tzOffsetMs('Europe/Moscow', at)).toBe(3 * 3_600_000);
    });

    it('Камчатка — UTC+12', () => {
      const at = new Date('2026-06-15T12:00:00Z');
      expect(tzOffsetMs('Asia/Kamchatka', at)).toBe(12 * 3_600_000);
    });

    it('Калининград — UTC+2 (самая западная зона списка)', () => {
      const at = new Date('2026-06-15T12:00:00Z');
      expect(tzOffsetMs('Europe/Kaliningrad', at)).toBe(2 * 3_600_000);
    });
  });

  describe('monthBoundsMs', () => {
    it('для Камчатки (UTC+12) месяц начинается на 12 часов раньше UTC-полуночи', () => {
      const { start, end } = monthBoundsMs('Asia/Kamchatka', 2026, 7);
      // 1 июля 00:00 по Камчатке = 30 июня 12:00 UTC
      expect(start.toISOString()).toBe('2026-06-30T12:00:00.000Z');
      // 1 августа 00:00 по Камчатке = 31 июля 12:00 UTC
      expect(end.toISOString()).toBe('2026-07-31T12:00:00.000Z');
    });

    it('для Москвы (UTC+3) месяц начинается на 3 часа раньше UTC-полуночи', () => {
      const { start, end } = monthBoundsMs('Europe/Moscow', 2026, 7);
      expect(start.toISOString()).toBe('2026-06-30T21:00:00.000Z');
      expect(end.toISOString()).toBe('2026-07-31T21:00:00.000Z');
    });

    it('декабрь корректно переходит в январь следующего года (по ЛОКАЛЬНОЙ дате компании)', () => {
      const { end } = monthBoundsMs('Europe/Moscow', 2026, 12);
      const lp = localParts('Europe/Moscow', end);
      expect(lp.y).toBe(2027);
      expect(lp.m).toBe(1);
      expect(lp.d).toBe(1);
    });

    it('запись за 23:30 по Камчатке 31-го числа НЕ утекает в следующий месяц по UTC-наивному расчёту', () => {
      // 31.07.2026 23:30 по Камчатке = 31.07.2026 11:30 UTC — по НАИВНОМУ new Date(year,month,1)
      // (UTC-конструктор) это всё ещё внутри месяца; регрессия ловится сравнением с monthBoundsMs.
      const kamchatkaLateJuly = new Date('2026-07-31T11:30:00Z');
      const { start, end } = monthBoundsMs('Asia/Kamchatka', 2026, 7);
      expect(kamchatkaLateJuly.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(kamchatkaLateJuly.getTime()).toBeLessThan(end.getTime());
    });
  });

  describe('weekBoundsFor', () => {
    it('среда → понедельник этой же недели', () => {
      const wb = weekBoundsFor('Europe/Moscow', new Date('2026-07-15T10:00:00Z')); // среда
      expect(wb.startDate).toBe('2026-07-13');
      expect(wb.endDate).toBe('2026-07-19');
    });

    it('воскресенье относится к СВОЕЙ (уже начавшейся) неделе, не к следующей', () => {
      const wb = weekBoundsFor('Europe/Moscow', new Date('2026-07-19T10:00:00Z')); // воскресенье
      expect(wb.startDate).toBe('2026-07-13');
    });
  });
});
