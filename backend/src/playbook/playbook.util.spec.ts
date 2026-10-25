import {
  computeTrend, shouldCreateCandidate, shouldReopenAfterDismissal,
  isCardOverdue, nextReviewDueDate, humanizeTagName, truncateQuote,
  findSemanticNeighbors, overlapsKnownCluster, stripReviewBoilerplate,
} from './playbook.util';

describe('playbook.util — детекция повторов и жизненный цикл карточки', () => {
  describe('computeTrend', () => {
    it('повтор участился — вторая половина окна тяжелее первой', () => {
      const now = new Date('2026-08-01T00:00:00Z');
      const dates = [
        new Date('2026-07-30T00:00:00Z'), // свежая половина (последние 21 день из 42)
        new Date('2026-07-29T00:00:00Z'),
        new Date('2026-07-28T00:00:00Z'),
        new Date('2026-06-25T00:00:00Z'), // старая половина
      ];
      expect(computeTrend(dates, 42, now)).toBe('increasing');
    });

    it('повтор затихает — старая половина тяжелее свежей', () => {
      const now = new Date('2026-08-01T00:00:00Z');
      const dates = [
        new Date('2026-07-30T00:00:00Z'),
        new Date('2026-06-25T00:00:00Z'),
        new Date('2026-06-24T00:00:00Z'),
        new Date('2026-06-23T00:00:00Z'),
      ];
      expect(computeTrend(dates, 42, now)).toBe('decreasing');
    });

    it('поровну — стабильно', () => {
      const now = new Date('2026-08-01T00:00:00Z');
      const dates = [new Date('2026-07-30T00:00:00Z'), new Date('2026-06-25T00:00:00Z')];
      expect(computeTrend(dates, 42, now)).toBe('stable');
    });

    it('пустой список — стабильно, а не падение с делением на ноль', () => {
      expect(computeTrend([], 42, new Date('2026-08-01T00:00:00Z'))).toBe('stable');
    });
  });

  describe('shouldCreateCandidate', () => {
    it('ниже порога — рано поднимать кандидата', () => {
      expect(shouldCreateCandidate(2, 3)).toBe(false);
    });
    it('на пороге — уже пора', () => {
      expect(shouldCreateCandidate(3, 3)).toBe(true);
    });
    it('выше порога — тем более пора', () => {
      expect(shouldCreateCandidate(10, 3)).toBe(true);
    });
  });

  describe('shouldReopenAfterDismissal', () => {
    it('РОП отклонил вчера — новый повтор в пределах старого счёта не переоткрывает карточку', () => {
      expect(shouldReopenAfterDismissal(6, 6, 3)).toBe(false);
      expect(shouldReopenAfterDismissal(8, 6, 3)).toBe(false);
    });
    it('после отклонения накопилось ещё delta повторов — переоткрываем', () => {
      expect(shouldReopenAfterDismissal(9, 6, 3)).toBe(true);
    });
    it('countAtDismissal отсутствует (легаси-запись) — считаем от нуля', () => {
      expect(shouldReopenAfterDismissal(3, null, 3)).toBe(true);
      expect(shouldReopenAfterDismissal(2, null, 3)).toBe(false);
    });
  });

  describe('isCardOverdue', () => {
    it('без даты пересмотра просрочки нет', () => {
      expect(isCardOverdue(null)).toBe(false);
    });
    it('дата в прошлом — просрочено', () => {
      expect(isCardOverdue('2020-01-01', new Date('2026-01-01'))).toBe(true);
    });
    it('дата в будущем — ещё не просрочено', () => {
      expect(isCardOverdue('2030-01-01', new Date('2026-01-01'))).toBe(false);
    });
  });

  describe('nextReviewDueDate', () => {
    it('прибавляет цикл в днях', () => {
      const due = nextReviewDueDate(new Date('2026-01-01T00:00:00Z'), 90);
      expect(due).toBe('2026-04-01');
    });
  });

  describe('humanizeTagName', () => {
    it('заменяет подчёркивания пробелами и делает первую букву заглавной', () => {
      expect(humanizeTagName('нет_конкретики')).toBe('Нет конкретики');
    });
    it('пустое имя не роняет функцию', () => {
      expect(humanizeTagName('')).toBe('Без названия');
    });
  });

  describe('findSemanticNeighbors — детекция повтора без тега', () => {
    const cosine = (a: number[], b: number[]) => {
      const dot = a.reduce((s, v, i) => s + v * b[i], 0);
      const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
      const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
      return dot / (na * nb);
    };

    it('находит только записи выше порога сходства', () => {
      const target = [1, 0];
      const pool = [
        { entryId: 'близкая', embedding: [0.9, 0.1] }, // cos ≈ 0.995
        { entryId: 'далёкая', embedding: [0, 1] }, // cos = 0
      ];
      expect(findSemanticNeighbors(target, pool, 0.62, cosine)).toEqual(['близкая']);
    });

    it('пустой пул — пустой результат, без падения', () => {
      expect(findSemanticNeighbors([1, 0], [], 0.62, cosine)).toEqual([]);
    });
  });

  describe('overlapsKnownCluster — не плодить дубль кандидата на тот же кластер', () => {
    it('совпадение по двум и более id — тот же кластер', () => {
      expect(overlapsKnownCluster(['a', 'b', 'c'], ['b', 'c', 'd'], 2)).toBe(true);
    });
    it('совпадение по одному id — считаем разными кластерами', () => {
      expect(overlapsKnownCluster(['a', 'b'], ['b', 'z'], 2)).toBe(false);
    });
    it('пустой известный кластер — не пересекается', () => {
      expect(overlapsKnownCluster(['a', 'b'], [], 2)).toBe(false);
    });
  });

  describe('stripReviewBoilerplate — структурные фразы стандарта не должны сближать РАЗНЫЕ ошибки', () => {
    it('вырезает три фразы-маркера структуры разбора, оставляя содержательный текст', () => {
      const text =
        'Что не так и почему важно: менеджер не назвал дату звонка. ' +
        'Как это повлияло на продажу: клиент пропал. ' +
        'Что попробовать в следующий раз: назначать дату самому.';
      const result = stripReviewBoilerplate(text);
      expect(result).not.toMatch(/что не так и почему/i);
      expect(result).not.toMatch(/как это повлияло/i);
      expect(result).not.toMatch(/что попробовать/i);
      expect(result).toContain('менеджер не назвал дату звонка');
      expect(result).toContain('назначать дату самому');
    });

    it('реальный случай 28.07.2026: два разных разбора без маркеров дают разный текст', () => {
      const a = stripReviewBoilerplate(
        'Что не так и почему важно: менеджер не назвал дату звонка после сметы.',
      );
      const b = stripReviewBoilerplate(
        'Что не так и почему важно: менеджер не назвал разницу с ручной штукатуркой.',
      );
      expect(a).not.toBe(b);
      expect(a).not.toMatch(/что не так/i);
    });

    it('текст без маркеров не портится', () => {
      expect(stripReviewBoilerplate('Обычный текст без структуры.')).toBe('Обычный текст без структуры.');
    });
  });

  describe('truncateQuote', () => {
    it('короткий текст остаётся как есть', () => {
      expect(truncateQuote('Коротко', 100)).toBe('Коротко');
    });
    it('длинный текст обрезается с многоточием', () => {
      const long = 'а'.repeat(300);
      const result = truncateQuote(long, 200);
      expect(result.length).toBe(201); // 200 символов + многоточие
      expect(result.endsWith('…')).toBe(true);
    });
  });
});
