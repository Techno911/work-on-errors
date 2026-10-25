import { GamificationService, getLevel, getMondayStr } from './gamification.service';
import { DEFAULT_XP_SETTINGS, DEFAULT_ACHIEVEMENT_SETTINGS } from './types/gamification-settings.types';

// Регресс-сетка на GAM2/GAM8: заморозка серии должна бриджить РОВНО одну пропущенную неделю
// (отпуск/больничный), а не разрыв любой длины. Раньше условие проверяло только «есть хоть
// одна заморозка», без сравнения с реальным разрывом — 5+ недель молчания бриджились одной
// заморозкой, серия «сама себя» восстанавливала, бонусы %4/%8 капали из воздуха.
describe('GamificationService.updateStreak (GAM2/GAM8)', () => {
  function buildService(gamState: any) {
    const gamRepo = {
      findOne: jest.fn().mockResolvedValue(gamState),
      save: jest.fn().mockImplementation((x: any) => { Object.assign(gamState, x); return Promise.resolve(gamState); }),
      create: jest.fn().mockImplementation((x: any) => ({ ...gamState, ...x })),
    };
    const achRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation((x: any) => x),
    };
    const txRepo = {
      save: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockImplementation((x: any) => x),
    };
    const userRepo = { findOne: jest.fn().mockResolvedValue({ companyId: 'c1' }) };
    const companiesRepo = {
      findOne: jest.fn().mockResolvedValue({
        xpSettings: DEFAULT_XP_SETTINGS,
        achievementSettings: DEFAULT_ACHIEVEMENT_SETTINGS,
      }),
    };
    return new GamificationService(gamRepo as any, achRepo as any, txRepo as any, userRepo as any, companiesRepo as any);
  }

  const thisWeek = getMondayStr();
  // Зеркалим ТОЧНО тот способ, которым сам updateStreak считает lastWeek/twoWeeksAgo внутри
  // (new Date(thisWeek) + setDate) — НЕ повторный вызов getMondayStr с сдвинутой датой:
  // тот заново нормализует день недели через ЛОКАЛЬНЫЕ методы Date и даёт расхождение
  // с внутренним расчётом сервиса на машинах не в UTC.
  const nWeeksAgo = (n: number) => {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - n * 7);
    return d.toISOString().split('T')[0];
  };

  it('бриджит РОВНО одну пропущенную неделю и тратит заморозку', async () => {
    const gamState: any = {
      userId: 'u1', totalXp: 0, currentStreak: 5, bestStreak: 5,
      streakFreezes: 1, lastStreakWeek: nWeeksAgo(2), // пропущена ровно 1 неделя
      consecutiveFullSelfReviews: 0, consecutiveNoErrorReviews: 0, consecutiveGreatWeeks: 0,
    };
    const svc = buildService(gamState);
    await svc.updateStreak('u1', 'c1');
    expect(gamState.currentStreak).toBe(6); // серия продолжилась
    expect(gamState.streakFreezes).toBe(0); // заморозка потрачена
  });

  it('НЕ бриджит разрыв в 5 недель даже при доступной заморозке — серия сбрасывается', async () => {
    const gamState: any = {
      userId: 'u2', totalXp: 0, currentStreak: 8, bestStreak: 8,
      streakFreezes: 1, lastStreakWeek: nWeeksAgo(5), // пропущено 4 недели — не «ровно одна»
      consecutiveFullSelfReviews: 0, consecutiveNoErrorReviews: 0, consecutiveGreatWeeks: 0,
    };
    const svc = buildService(gamState);
    await svc.updateStreak('u2', 'c1');
    expect(gamState.currentStreak).toBe(1); // сброс, не 9
    expect(gamState.streakFreezes).toBe(1); // заморозка НЕ тронута
  });

  it('нормальное продолжение (пропусков нет) — без расхода заморозки', async () => {
    const gamState: any = {
      userId: 'u3', totalXp: 0, currentStreak: 3, bestStreak: 3,
      streakFreezes: 2, lastStreakWeek: nWeeksAgo(1), // прошлая неделя — обычное продолжение
      consecutiveFullSelfReviews: 0, consecutiveNoErrorReviews: 0, consecutiveGreatWeeks: 0,
    };
    const svc = buildService(gamState);
    await svc.updateStreak('u3', 'c1');
    expect(gamState.currentStreak).toBe(4);
    expect(gamState.streakFreezes).toBe(2);
  });
});

describe('getLevel', () => {
  it('0 XP — Стажёр, уровень 1', () => {
    expect(getLevel(0).level).toBe(1);
  });

  it('5500+ XP — Эталон, максимальный уровень без nextXp', () => {
    const l = getLevel(5500);
    expect(l.level).toBe(7);
    expect(l.nextXp).toBeNull();
  });

  it('граница уровня — ровно на пороге уже новый уровень', () => {
    expect(getLevel(199).level).toBe(1);
    expect(getLevel(200).level).toBe(2);
  });
});
