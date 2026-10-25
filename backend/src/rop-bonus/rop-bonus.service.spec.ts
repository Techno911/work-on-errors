import { RopBonusService } from './rop-bonus.service';
import { RopBonusData, RopBonusTier } from '../companies/entities/company.entity';

// Регресс-сетка на CALC1/CALC2 (двойное округление премии) и на линейную формулу по договору.
// Приватные калькуляторы (amountForPct/resolveTier/isLinear) — вызываем через (svc as any),
// репозитории сервису не нужны для этих чистых расчётов.
describe('RopBonusService — расчёт премии', () => {
  const svc = new RopBonusService({} as any, {} as any, {} as any, {} as any);
  const call = (name: string, ...args: any[]) => (svc as any)[name](...args);

  describe('линейный режим (baseAmount задан — приоритет над tiers)', () => {
    const rb: RopBonusData = { enabled: true, tiers: [], baseAmount: 20000, minThresholdPct: 60 };

    it('точный процент БЕЗ промежуточного округления — 13333₽, не 13400₽ (CALC1/CALC2)', () => {
      // 66.666...% от 20000 — раньше сначала округляли % (67%), потом считали сумму
      // (20000×67/100=13400₽, неверно); правильно — округлить только итоговую сумму
      // (20000×66.666.../100=13333.33 → 13333₽).
      const amount = call('amountForPct', rb, [], 200 / 3);
      expect(amount).toBe(13333);
    });

    it('ровно на отсечке (60%) — премия начисляется', () => {
      expect(call('amountForPct', rb, [], 60)).toBe(12000);
    });

    it('ниже отсечки — премия 0, а не пропорциональная часть', () => {
      expect(call('amountForPct', rb, [], 59.9)).toBe(0);
    });

    it('100% — вся базовая сумма', () => {
      expect(call('amountForPct', rb, [], 100)).toBe(20000);
    });

    it('отсечка по умолчанию 60, если minThresholdPct не задан', () => {
      const rbNoMin: RopBonusData = { enabled: true, tiers: [], baseAmount: 10000 };
      expect(call('amountForPct', rbNoMin, [], 55)).toBe(0);
      expect(call('amountForPct', rbNoMin, [], 65)).toBe(6500);
    });
  });

  describe('ступенчатый режим (легаси, baseAmount не задан)', () => {
    const rb: RopBonusData = { enabled: true, tiers: [] };
    const tiers: RopBonusTier[] = [
      { thresholdPct: 95, amount: 20000 },
      { thresholdPct: 80, amount: 16000 },
    ];

    it('resolveTier берёт наивысший достигнутый порог', () => {
      expect(call('resolveTier', tiers, 97)).toEqual({ thresholdPct: 95, amount: 20000 });
      expect(call('resolveTier', tiers, 85)).toEqual({ thresholdPct: 80, amount: 16000 });
      expect(call('resolveTier', tiers, 50)).toBeNull();
    });

    it('amountForPct делегирует в resolveTier, когда baseAmount не задан', () => {
      expect(call('amountForPct', rb, tiers, 85)).toBe(16000);
      expect(call('amountForPct', rb, tiers, 10)).toBe(0);
    });
  });

  describe('isLinear', () => {
    it('baseAmount > 0 — линейный режим', () => {
      expect(call('isLinear', { enabled: true, tiers: [], baseAmount: 1 })).toBe(true);
    });
    it('baseAmount отсутствует/0 — ступенчатый режим', () => {
      expect(call('isLinear', { enabled: true, tiers: [] })).toBe(false);
      expect(call('isLinear', { enabled: true, tiers: [], baseAmount: 0 })).toBe(false);
    });
  });

  describe('normalizeTiers — CALC-DTO: защита от мусора даже если провалидированные данные обошли DTO', () => {
    it('отбрасывает некорректные значения (порог вне 1..100, отрицательная сумма)', () => {
      const result = call('normalizeTiers', [
        { thresholdPct: 150, amount: 5000 },
        { thresholdPct: 50, amount: -100 },
        { thresholdPct: 80, amount: 1000 },
      ]);
      expect(result).toEqual([{ thresholdPct: 80, amount: 1000 }]);
    });

    it('дубли порога — оставляет максимальную сумму', () => {
      const result = call('normalizeTiers', [
        { thresholdPct: 80, amount: 1000 },
        { thresholdPct: 80, amount: 5000 },
      ]);
      expect(result).toEqual([{ thresholdPct: 80, amount: 5000 }]);
    });

    it('сортирует по убыванию порога', () => {
      const result = call('normalizeTiers', [
        { thresholdPct: 50, amount: 1000 },
        { thresholdPct: 90, amount: 5000 },
      ]);
      expect(result.map((t: RopBonusTier) => t.thresholdPct)).toEqual([90, 50]);
    });
  });
});
