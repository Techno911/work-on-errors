/**
 * Сравнение нормативов компании: что именно поменялось и как это назвать человеку.
 *
 * Зачем заведено 24.08.2026. У одного клиента планка стояла на режиме «Жёсткий» (8 разборов
 * в неделю вместо 5, самоанализ 200/250 знаков вместо 100/150, обязательное третье поле),
 * команда упёрлась в неё и спросила у нас, почему стало восемь. Ответить было нечем: журнал
 * компании фиксировал сигналы и проверки каналов, а смену нормативов не писал никто. Кто и
 * когда поднял планку, восстановить не удалось даже по данным, только косвенно по длинам
 * самоанализа в записях.
 *
 * Поэтому список полей живёт здесь один на все входы: нормативы меняются из карточки трекера
 * (режим целиком) и из настроек владельца (поштучно), и обе поверхности обязаны писать
 * одинаковое событие. Копия этого списка в каждом входе разошлась бы на первой же правке.
 */

/** Поле норматива и его имя для строки журнала (родительный падеж не нужен, читается парой). */
export interface NormField {
  /** Путь: либо поле компании, либо reviewNorms.<поле> внутри jsonb. */
  key: string;
  label: string;
}

export const NORM_FIELDS: NormField[] = [
  { key: 'callsPerWeek', label: 'звонков в неделю' },
  { key: 'chatsPerWeek', label: 'переписок в неделю' },
  { key: 'thresholdGoodCalls', label: 'порог «норма» по звонкам' },
  { key: 'thresholdGreatCalls', label: 'порог «сильная неделя» по звонкам' },
  { key: 'thresholdGoodChats', label: 'порог «норма» по перепискам' },
  { key: 'thresholdGreatChats', label: 'порог «сильная неделя» по перепискам' },
  { key: 'minSelfReviewCorrectChars', label: 'самоанализ «что сделано правильно», знаков' },
  { key: 'minSelfReviewImproveChars', label: 'самоанализ «что можно улучшить», знаков' },
  { key: 'minSelfReviewSuggestionsChars', label: 'самоанализ «конкретные предложения», знаков' },
  { key: 'minReviewChars', label: 'разбор руководителя, знаков' },
  { key: 'reviewNorms.minReviewsPerWeek', label: 'разборов в неделю у руководителя' },
  { key: 'reviewNorms.maxHoursToRespond', label: 'срок разбора, рабочих часов' },
  { key: 'reviewNorms.minReviewCharsAvg', label: 'средняя длина разбора, знаков' },
  { key: 'reviewNorms.qualityThresholdPct', label: 'порог качества разборов, процентов' },
];

export interface NormChange {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
}

type Bag = Record<string, unknown>;

function readValue(source: Bag | null | undefined, key: string): number | null {
  if (!source) return null;
  const [head, tail] = key.split('.');
  const raw = tail ? (source[head] as Bag | null | undefined)?.[tail] : source[head];
  return typeof raw === 'number' ? raw : null;
}

/**
 * Что изменилось между двумя состояниями компании. Поле, которого нет в новом состоянии
 * (владелец прислал частичный набор настроек), изменением НЕ считается: иначе каждое
 * сохранение соседней вкладки писало бы в журнал выдуманное «стало пусто».
 */
export function diffNorms(before: Bag | null | undefined, after: Bag | null | undefined): NormChange[] {
  const changes: NormChange[] = [];
  for (const field of NORM_FIELDS) {
    const to = readValue(after, field.key);
    if (to === null) continue;
    const from = readValue(before, field.key);
    if (from === to) continue;
    changes.push({ key: field.key, label: field.label, from, to });
  }
  return changes;
}

/** Строка для человека: «звонков в неделю: 5 → 8; переписок в неделю: 5 → 8». */
export function describeNormChanges(changes: NormChange[]): string {
  return changes
    .map(c => `${c.label}: ${c.from === null ? 'не задано' : c.from} → ${c.to}`)
    .join('; ');
}
