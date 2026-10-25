import type { PlaybookTrend } from './entities/playbook-card.entity';

export const PLAYBOOK_CANDIDATE_WINDOW_DAYS = 42; // 6 недель — то же окно, что советует стандарт блока
export const PLAYBOOK_CANDIDATE_THRESHOLD = 3; // минимум повторов, чтобы не поднимать кандидата на разовый случай
export const PLAYBOOK_REOPEN_DELTA = 3; // после отклонения — снова показываем, только если тег отметили ещё N раз
export const PLAYBOOK_REVIEW_CYCLE_DAYS = 90; // квартальный пересмотр, тот же ритм, что у аналитики блока
export const PLAYBOOK_TARGET_CARDS = 10; // ориентир «минимум 10 страниц» из требования владельца продукта

// Семантическая детекция (страховка на случай, если РОП не поставил тег): порог косинусного
// сходства двух эмбеддингов reviewText, ниже которого разборы не считаем «про одно и то же».
// Откалибровано на тесте bge-m3 (28.07.2026): пара разборов про цену дала cos≈0.68, разборы
// про разные темы — cos≈0.46. Порог ставим между ними, ближе к похожим, чтобы не плодить
// ложные кластеры из общих слов темы «продажи».
export const PLAYBOOK_SEMANTIC_THRESHOLD = 0.62;

/**
 * Тренд повтора: делим окно пополам и сравниваем свежую половину со старой.
 * Чистая функция — не ходит в БД, поэтому дёшево тестируется без моков репозитория.
 */
export function computeTrend(
  reviewedDates: Date[],
  windowDays: number = PLAYBOOK_CANDIDATE_WINDOW_DAYS,
  now: Date = new Date(),
): PlaybookTrend {
  const halfMs = (windowDays / 2) * 24 * 60 * 60 * 1000;
  const cutoff = new Date(now.getTime() - halfMs);
  let recent = 0;
  let older = 0;
  for (const d of reviewedDates) {
    if (d >= cutoff) recent++;
    else older++;
  }
  if (recent === older) return 'stable';
  return recent > older ? 'increasing' : 'decreasing';
}

/** Считаем кандидата достойным внимания РОПа только при накопленном повторе, не на первый случай. */
export function shouldCreateCandidate(count: number, threshold: number = PLAYBOOK_CANDIDATE_THRESHOLD): boolean {
  return count >= threshold;
}

/**
 * Отклонённую карточку не поднимаем повторно на следующий же разбор — иначе РОП увидит
 * то же самое решение снова через день. Поднимаем, только если тег отметили ещё раз(а)
 * СВЕРХ того количества, что было на момент отклонения.
 */
export function shouldReopenAfterDismissal(
  currentCount: number,
  countAtDismissal: number | null,
  reopenDelta: number = PLAYBOOK_REOPEN_DELTA,
): boolean {
  const base = countAtDismissal ?? 0;
  return currentCount - base >= reopenDelta;
}

/** Просроченная карточка (квартал без пересмотра) помечается непроверенной. */
export function isCardOverdue(reviewDueAt: string | null, now: Date = new Date()): boolean {
  if (!reviewDueAt) return false;
  return new Date(reviewDueAt) < now;
}

export function nextReviewDueDate(from: Date = new Date(), cycleDays: number = PLAYBOOK_REVIEW_CYCLE_DAYS): string {
  const d = new Date(from);
  d.setDate(d.getDate() + cycleDays);
  return d.toISOString().slice(0, 10);
}

// Форма разбора подсказывает РОПу структуру прямо над полем «Ревью» («что сделано не так и
// почему это важно · как влияет на результат продажи · что попробовать в следующий раз»),
// поэтому эти три фразы-маркера встречаются ОДИНАКОВО почти в каждом разборе у ЛЮБОГО клиента.
// Если эмбеддить текст ревью как есть, эти совпадающие маркеры «разбавляют» сигнал и сближают
// РАЗНЫЕ по сути ошибки — так и вышло в ручном прогоне: два разных правила (цена без замера и
// звонок после сметы) слиплись в один семантический кластер под общим невнятным правилом.
// Вырезаем маркеры перед эмбеддингом, оставляя только содержательный текст разбора.
const REVIEW_BOILERPLATE = [
  /что\s+не\s+так\s+и\s+почему\s+(?:это\s+)?важно\s*:/gi,
  /как\s+это\s+повлияло\s+на\s+(?:результат\s+)?продаж[уи]\s*:/gi,
  /что\s+попробовать\s+в\s+следующий\s+раз\s*:/gi,
];

export function stripReviewBoilerplate(text: string): string {
  let result = text;
  for (const pattern of REVIEW_BOILERPLATE) {
    result = result.replace(pattern, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** «нет_конкретики» → «Нет конкретики» — черновик заголовка карточки, РОП его правит при подтверждении. */
export function humanizeTagName(name: string): string {
  const spaced = name.replace(/_/g, ' ').trim();
  if (!spaced) return 'Без названия';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function truncateQuote(text: string, maxLen: number): string {
  const clean = text.trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen).trimEnd()}…`;
}

export interface EmbeddedEntry {
  entryId: string;
  embedding: number[];
}

/**
 * Из пула прошлых разборов отбирает те, что семантически похожи на текущий (cosine >= порог).
 * Чистая функция — вектора и порог приходят готовыми, сравнение не ходит в сеть/БД.
 */
export function findSemanticNeighbors(
  targetEmbedding: number[],
  pool: EmbeddedEntry[],
  threshold: number,
  cosineFn: (a: number[], b: number[]) => number,
): string[] {
  return pool
    .filter((p) => cosineFn(targetEmbedding, p.embedding) >= threshold)
    .map((p) => p.entryId);
}

/**
 * Семантический кандидат не поднимается второй раз на тот же кластер разборов: если новый
 * найденный кластер по большей части (minOverlap и больше id) совпадает с уже известным
 * источником живой карточки — это тот же повтор, просто её нужно освежить, а не плодить дубль.
 */
export function overlapsKnownCluster(
  candidateIds: string[],
  knownIds: string[],
  minOverlap = 2,
): boolean {
  const known = new Set(knownIds);
  let common = 0;
  for (const id of candidateIds) {
    if (known.has(id)) common++;
  }
  return common >= minOverlap;
}
