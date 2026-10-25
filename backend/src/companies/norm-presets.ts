/**
 * Готовые режимы нормативов — ЕДИНСТВЕННЫЙ источник значений.
 *
 * Живут на бэке, потому что применять их должны двое: владелец из своих Настроек и трекер из
 * карточки компании (нормативы — его зона ответственности по продукту). Копия значений на фронте
 * означала бы, что один и тот же режим у владельца и у трекера расходится при первой же правке.
 */

export type NormPresetName = 'soft' | 'standard' | 'strict';

export type NormPreset = {
  name: NormPresetName;
  label: string;
  tone: string;
  data: Record<string, unknown>;
};

export const NORM_PRESETS: Record<NormPresetName, NormPreset> = {
  soft: {
    name: 'soft',
    label: 'Мягкий',
    tone: 'Низкие нормы, чтобы команда вошла без стресса',
    data: {
      callsPerWeek: 3,
      chatsPerWeek: 3,
      thresholdGoodCalls: 3,
      thresholdGreatCalls: 5,
      thresholdGoodChats: 3,
      thresholdGreatChats: 5,
      minSelfReviewCorrectChars: 50,
      minSelfReviewImproveChars: 80,
      minSelfReviewSuggestionsChars: 0,
      minReviewChars: 100,
      gamificationEnabled: true,
      reviewerCanEditReviewTemplates: false,
      reviewerCanEditGamification: false,
      reviewNorms: {
        minReviewsPerWeek: 0,
        maxHoursToRespond: 72,
        minReviewCharsAvg: 100,
        qualityThresholdPct: 70,
      },
    },
  },
  standard: {
    name: 'standard',
    label: 'Стандартный',
    tone: 'Рекомендованные значения для большинства компаний',
    data: {
      callsPerWeek: 5,
      chatsPerWeek: 5,
      thresholdGoodCalls: 5,
      thresholdGreatCalls: 8,
      thresholdGoodChats: 5,
      thresholdGreatChats: 8,
      minSelfReviewCorrectChars: 100,
      minSelfReviewImproveChars: 150,
      minSelfReviewSuggestionsChars: 0,
      minReviewChars: 150,
      gamificationEnabled: true,
      reviewerCanEditReviewTemplates: false,
      reviewerCanEditGamification: false,
      reviewNorms: {
        minReviewsPerWeek: 5,
        maxHoursToRespond: 24,
        minReviewCharsAvg: 150,
        qualityThresholdPct: 80,
      },
    },
  },
  strict: {
    name: 'strict',
    label: 'Жёсткий',
    tone: 'Высокие требования для зрелой команды',
    data: {
      callsPerWeek: 8,
      chatsPerWeek: 8,
      thresholdGoodCalls: 8,
      thresholdGreatCalls: 12,
      thresholdGoodChats: 8,
      thresholdGreatChats: 12,
      minSelfReviewCorrectChars: 200,
      minSelfReviewImproveChars: 250,
      minSelfReviewSuggestionsChars: 100,
      minReviewChars: 250,
      gamificationEnabled: true,
      reviewerCanEditReviewTemplates: true,
      reviewerCanEditGamification: false,
      reviewNorms: {
        minReviewsPerWeek: 10,
        maxHoursToRespond: 24,
        minReviewCharsAvg: 250,
        qualityThresholdPct: 90,
      },
    },
  },
};

export const NORM_PRESET_LIST: NormPreset[] = [
  NORM_PRESETS.soft,
  NORM_PRESETS.standard,
  NORM_PRESETS.strict,
];
