import { computeAttemptResult, parseGeneratedQuestions, parseGradedAnswer, discardTooShort } from './attestation.util';

describe('computeAttemptResult', () => {
  it('все ответы на максимум — 100%, сдал', () => {
    const r = computeAttemptResult(
      [{ score: 2, weight: 1, isCritical: false }, { score: 2, weight: 1, isCritical: false }],
      75,
    );
    expect(r.totalScorePercent).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.failedCritical).toBe(false);
  });

  it('процент выше порога, но провален критичный вопрос — не сдал (грубая ошибка не теряется в среднем)', () => {
    const r = computeAttemptResult(
      [
        { score: 2, weight: 3, isCritical: false },
        { score: 2, weight: 3, isCritical: false },
        { score: 0, weight: 1, isCritical: true },
      ],
      75,
    );
    expect(r.totalScorePercent).toBeGreaterThanOrEqual(75); // без правила критичности сдал бы
    expect(r.failedCritical).toBe(true);
    expect(r.passed).toBe(false);
  });

  it('процент ниже порога — не сдал', () => {
    const r = computeAttemptResult([{ score: 1, weight: 1, isCritical: false }], 75);
    expect(r.totalScorePercent).toBe(50);
    expect(r.passed).toBe(false);
  });

  it('вес учитывается — тяжёлый вопрос перевешивает лёгкий', () => {
    const r = computeAttemptResult(
      [{ score: 0, weight: 1, isCritical: false }, { score: 2, weight: 3, isCritical: false }],
      75,
    );
    // (0*1 + 2*3) / (1+3) / 2 * 100 = 75%
    expect(r.totalScorePercent).toBe(75);
  });

  it('пустой список ответов — 0%, не сдал, без деления на ноль', () => {
    const r = computeAttemptResult([], 75);
    expect(r.totalScorePercent).toBe(0);
    expect(r.passed).toBe(false);
  });
});

describe('parseGeneratedQuestions', () => {
  it('разбирает все три вопроса из ответа модели', () => {
    const raw = 'ЗНАНИЕ: Как называть цену?\nСИТУАЦИЯ: Клиент спросил цену. Что ответите?\nПРОБА: Развёрнутый кейс с деталями.';
    const q = parseGeneratedQuestions(raw);
    expect(q.knowledge).toBe('Как называть цену?');
    expect(q.situation).toBe('Клиент спросил цену. Что ответите?');
    expect(q.practice).toBe('Развёрнутый кейс с деталями.');
  });

  it('модель не ответила по формату — все null, не падаем', () => {
    const q = parseGeneratedQuestions('что-то невпопад без маркеров');
    expect(q).toEqual({ knowledge: null, situation: null, practice: null });
  });

  it('модель на CPU повторила метки с вариациями внутри поля — берём только первый блок (реальный случай с прода 28.07.2026)', () => {
    const raw =
      'СИТУАЦИЯ: Клиент спрашивает о цене, но говорит, что это зависит от объёма работ.\n\n' +
      'ЗНАНИЕ: Называете вилку цены сразу.\n\n' +
      'СИТУАЦИЯ: Ещё один вариант вопроса, который модель придумала лишним.';
    const q = parseGeneratedQuestions(raw);
    expect(q.situation).toBe('Клиент спрашивает о цене, но говорит, что это зависит от объёма работ.');
    expect(q.knowledge).toBe('Называете вилку цены сразу.');
  });

  it('лишний текст модели после последнего маркера не режется', () => {
    const raw = 'ЗНАНИЕ: вопрос1\nПРОБА: вопрос2 с продолжением\nна вторую строку';
    const q = parseGeneratedQuestions(raw);
    expect(q.practice).toBe('вопрос2 с продолжением\nна вторую строку');
  });
});

describe('parseGradedAnswer', () => {
  it('разбирает балл и обоснование', () => {
    const r = parseGradedAnswer('БАЛЛ: 1\nПОЧЕМУ: Узнал тему, но нарушил правило про скидку');
    expect(r.score).toBe(1);
    expect(r.reasoning).toBe('Узнал тему, но нарушил правило про скидку');
  });

  it('модель не ответила по формату — score null, не падаем', () => {
    const r = parseGradedAnswer('мимо формата');
    expect(r.score).toBeNull();
  });
});

describe('discardTooShort — вопрос без контекста сотруднику лучше не показывать вовсе', () => {
  it('реальный случай с прода 28.07.2026: модель отдала голый вопрос без ситуации — отбрасываем', () => {
    const r = discardTooShort({ knowledge: 'Правило пересказано', situation: 'нормальная ситуация с деталями разговора', practice: 'Что вы ответите?' });
    expect(r.practice).toBeNull();
    expect(r.situation).toBe('нормальная ситуация с деталями разговора');
  });

  it('знание не проверяется на длину — короткий пересказ правила это нормально', () => {
    const r = discardTooShort({ knowledge: 'Коротко', situation: null, practice: null });
    expect(r.knowledge).toBe('Коротко');
  });

  it('null остаётся null, не падаем на отсутствующем тексте', () => {
    const r = discardTooShort({ knowledge: null, situation: null, practice: null });
    expect(r.situation).toBeNull();
    expect(r.practice).toBeNull();
  });
});
