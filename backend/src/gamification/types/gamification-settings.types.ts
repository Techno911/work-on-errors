export interface XpSettingsData {
  entrySubmitted: number;      // +5 по умолчанию
  selfReviewComplete: number;  // +10
  reviewReceived: number;      // +5
  reviewNoErrors: number;      // +15
  weeklyGoodZone: number;      // +15
  weeklyGreatZone: number;     // +30
  streakBonus: number;         // +5
}

export interface AchievementSettingsData {
  sniperThreshold: number;    // 3 — сколько подряд ревью без ошибок
  writerThreshold: number;    // 5 — сколько подряд подробных самоанализов
  great3xThreshold: number;   // 3 — сколько подряд недель «Красавчик»
  streak7Threshold: number;   // 7 — стрик «Неделимый»
  streak30Threshold: number;  // 30 — стрик «Легенда»
}

// Ребаланс: качество и результат недели весят больше потока загрузок.
// reviewNoErrors = 0: бонус за «разбор без ошибок» поощрял прятать ошибки —
// отключён до появления механики «без повторения старых ошибок».
export const DEFAULT_XP_SETTINGS: XpSettingsData = {
  entrySubmitted: 3,
  selfReviewComplete: 10,
  reviewReceived: 2,
  reviewNoErrors: 0,
  weeklyGoodZone: 30,
  weeklyGreatZone: 60,
  streakBonus: 25,
};

export const DEFAULT_ACHIEVEMENT_SETTINGS: AchievementSettingsData = {
  sniperThreshold: 3,
  writerThreshold: 5,
  great3xThreshold: 3,
  streak7Threshold: 7,
  streak30Threshold: 30,
};
