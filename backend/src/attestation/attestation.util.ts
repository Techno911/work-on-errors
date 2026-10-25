export interface ScoredAnswer {
  score: 0 | 1 | 2;
  weight: number;
  isCritical: boolean;
}

export interface AttemptResult {
  totalScorePercent: number;
  failedCritical: boolean;
  passed: boolean;
}

/**
 * Итоговый процент — взвешенное среднее баллов (0/1/2 → 0/50/100%), плюс отдельная проверка
 * критичных вопросов: провал критичного (балл 0) валит попытку независимо от процента, даже
 * если остальные ответы компенсировали бы средний балл (план: «одна мелочь не должна валить
 * человека так же, как грубая ошибка» — и симметрично, грубая не должна теряться в среднем).
 */
export function computeAttemptResult(answers: ScoredAnswer[], passingScorePercent: number): AttemptResult {
  const totalWeight = answers.reduce((s, a) => s + a.weight, 0);
  const totalScorePercent = totalWeight === 0
    ? 0
    : Math.round((answers.reduce((s, a) => s + (a.score / 2) * a.weight, 0) / totalWeight) * 1000) / 10;
  const failedCritical = answers.some((a) => a.isCritical && a.score === 0);
  const passed = !failedCritical && totalScorePercent >= passingScorePercent;
  return { totalScorePercent, failedCritical, passed };
}

export interface GeneratedQuestionSet {
  knowledge: string | null;
  situation: string | null;
  practice: string | null;
}

const ALL_LABELS = ['ЗНАНИЕ', 'СИТУАЦИЯ', 'ПРОБА'];

/**
 * Разбор ответа LLM на три вопроса по карточке (маркеры ЗНАНИЕ:/СИТУАЦИЯ:/ПРОБА:). Модель на
 * CPU иногда «разгоняется» и после нужного ответа сама повторяет метки с вариациями — стоп на
 * ЛЮБОЙ из трёх меток (а не только следующей по порядку) страхует от захвата этого мусора,
 * а обрезка по первому пустому абзацу — от продолжения того же поля лишним текстом.
 * Чистая функция — сеть не трогает, дёшево тестируется на реальных и на кривых ответах модели.
 */
export function parseGeneratedQuestions(raw: string): GeneratedQuestionSet {
  const extract = (label: string): string | null => {
    const stopPattern = ALL_LABELS.join('|');
    const re = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${stopPattern}):|$)`, 'i');
    const m = raw.match(re);
    let text = m?.[1]?.trim() ?? '';
    // Модель начала новый (лишний) блок с пустой строки, не с метки — обрезаем по первому
    // пустому абзацу, оставляя только реальный ответ на этот вопрос.
    text = text.split(/\n\s*\n/)[0].trim();
    return text || null;
  };
  return {
    knowledge: extract('ЗНАНИЕ'),
    situation: extract('СИТУАЦИЯ'),
    practice: extract('ПРОБА'),
  };
}

// «Ситуация» и «проба» обязаны нести описание кейса — сотрудник иначе получает вопрос вроде
// «Что вы ответите?» без единого слова контекста и физически не может ответить осмысленно
// (выловлено ручным прогоном аттестации на демо-данных). CPU-модель иногда не выполняет
// инструкцию «более развёрнутый кейс с деталями» и выдаёт голый вопрос — лучше не показать
// сотруднику вопрос вовсе (как при недоступной Ollama), чем показать вопрос без контекста.
const MIN_CONTEXT_CHARS = 40;

export function discardTooShort(parsed: GeneratedQuestionSet): GeneratedQuestionSet {
  return {
    knowledge: parsed.knowledge,
    situation: (parsed.situation?.length ?? 0) >= MIN_CONTEXT_CHARS ? parsed.situation : null,
    practice: (parsed.practice?.length ?? 0) >= MIN_CONTEXT_CHARS ? parsed.practice : null,
  };
}

/** Разбор ответа LLM на оценку ответа сотрудника (маркеры БАЛЛ:/ПОЧЕМУ:). */
export function parseGradedAnswer(raw: string): { score: 0 | 1 | 2 | null; reasoning: string | null } {
  const scoreMatch = raw.match(/БАЛЛ:\s*([012])/i);
  const reasonMatch = raw.match(/ПОЧЕМУ:\s*([\s\S]+)/i);
  const score = scoreMatch ? (Number(scoreMatch[1]) as 0 | 1 | 2) : null;
  const reasoning = reasonMatch ? reasonMatch[1].trim() : null;
  return { score, reasoning };
}
