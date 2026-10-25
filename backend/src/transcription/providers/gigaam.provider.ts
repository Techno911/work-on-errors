import { Injectable, Logger } from '@nestjs/common';
import { readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { TranscriptionProvider, ProviderResult, Utterance } from './transcription-provider.interface';
import { AudioConverterService } from '../audio-converter.service';

// Свой сервер распознавания (GigaAM v3 в контейнере gigastt) вместо платного SaluteSpeech.
// Причина замены: с 15.07.2026 Сбер убрал бесплатные тарифы, а минимальный платёж юрлица
// фиксированная цена при реальном расходе около 400 ₽ — переплата в десятки раз.
// Модель та же по происхождению (GigaAM выпущен Сбером под MIT), качество на телефонии
// сопоставимое, стоимость нулевая.
//
// Ходим не в интернет, а в SSH-туннель (systemd-юнит stt-tunnel на проде): наружу порт
// сервиса не выставлен, ключ на той стороне ограничен permitopen только этим портом.
const BASE_URL = process.env.STT_BASE_URL || 'http://localhost:9876';
const REQUEST_TIMEOUT_MS = 120_000;
// Файл читаем в память целиком: наши записи это MP3 16 кГц (час разговора ≈ 21 МБ в моно).
// Потолок бережёт память прода, где живёт не только эта платформа.
const MAX_FILE_BYTES = 120 * 1024 * 1024;
// Пауза между словами, по которой режем поток на реплики. 1.2 с — эмпирическая граница
// между паузой внутри фразы и сменой реплики в телефонном разговоре.
const REPLICA_GAP_SEC = 1.2;
// Разделитель составного идентификатора задачи для стереозаписи: канал 0 и канал 1.
const TASK_SEP = '|';
// Доля общих слов, выше которой считаем, что в каналах записан один и тот же звук.
const DUPLICATE_RATIO = 0.9;

interface JobWord {
  word: string;
  start?: number;
  end?: number;
}

@Injectable()
export class GigaamProvider implements TranscriptionProvider {
  private readonly logger = new Logger(GigaamProvider.name);
  readonly name = 'gigaam';

  constructor(private readonly converter: AudioConverterService) {}

  // Сервис считается настроенным всегда, пока задан адрес: ключей и оплаты у него нет,
  // а недоступность туннеля вылезет как ошибка запроса и уйдёт в алерт.
  get enabled(): boolean {
    return Boolean(BASE_URL);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  /** Отправляет один файл в очередь распознавания и возвращает идентификатор задачи. */
  private async postJob(audioFilePath: string): Promise<string> {
    const buf = await readFile(audioFilePath);
    if (buf.byteLength > MAX_FILE_BYTES) {
      throw new Error(`Файл ${Math.round(buf.byteLength / 1024 / 1024)} МБ больше допустимых 120 МБ`);
    }
    const form = new FormData();
    form.append('file', new Blob([buf]), 'audio.mp3');

    const res = await this.request('/v1/jobs', { method: 'POST', body: form });
    if (!res.ok) {
      throw new Error(`gigaam POST /v1/jobs ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { job_id?: string };
    if (!data.job_id) throw new Error('gigaam POST /v1/jobs: нет job_id в ответе');
    return data.job_id;
  }

  /**
   * Стереозапись (собеседники разведены по каналам) распознаём КАНАЛАМИ: два независимых
   * задания, каждое слышит только своего человека. Это даёт точное разделение говорящих без
   * нейросетевой диаризации, которая на телефонной речи ошибается в 10–25% случаев.
   * Разделённые каналы живут только до отправки: сервис уже принял байты, файлы не нужны.
   */
  async createTask(audioFilePath: string): Promise<{ taskId: string }> {
    const channels = await this.converter.getChannels(audioFilePath);
    if (channels !== 2) {
      return { taskId: await this.postJob(audioFilePath) };
    }

    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const left = join(tmpdir(), `stt-${stamp}-0.mp3`);
    const right = join(tmpdir(), `stt-${stamp}-1.mp3`);
    try {
      await this.converter.splitChannels(audioFilePath, left, right);
      const [a, b] = await Promise.all([this.postJob(left), this.postJob(right)]);
      return { taskId: `${a}${TASK_SEP}${b}` };
    } finally {
      await unlink(left).catch(() => undefined);
      await unlink(right).catch(() => undefined);
    }
  }

  /** Статус одной задачи: 'processing' | 'done' | 'failed' с текстом ошибки. */
  private async jobStatus(id: string): Promise<{ state: 'processing' | 'done' | 'failed'; error?: string }> {
    const res = await this.request(`/v1/jobs/${encodeURIComponent(id)}`);
    // 404 = задачу вытеснило из памяти сервиса по TTL (перезапуск контейнера, переполнение
    // очереди). Возвращать 'processing' нельзя: поллинг крутился бы до дедлайна впустую.
    if (res.status === 404) {
      return { state: 'failed', error: 'задача не найдена на сервере распознавания (истёк срок хранения)' };
    }
    if (!res.ok) throw new Error(`gigaam GET /v1/jobs ${res.status}`);
    const job = (await res.json()) as { status?: string; error?: string };
    const st = (job.status || '').toLowerCase();
    // Списком перечисляем ТОЛЬКО терминальные статусы, всё остальное считаем «ещё идёт».
    // Обратный порядок (перечислить промежуточные) уже подвёл: сервис отдаёт `processing`,
    // которого не было в списке, и задача падала как отказ при живой обработке.
    const DONE = ['done', 'completed', 'succeeded', 'finished'];
    const FAILED = ['failed', 'error', 'cancelled', 'canceled', 'timeout'];
    if (FAILED.includes(st)) return { state: 'failed', error: job.error || `статус задачи: ${st}` };
    return { state: DONE.includes(st) ? 'done' : 'processing' };
  }

  private async jobResult(id: string): Promise<{ text?: string; words?: JobWord[] }> {
    const res = await this.request(`/v1/jobs/${encodeURIComponent(id)}/result`);
    if (!res.ok) throw new Error(`gigaam GET /v1/jobs/result ${res.status}`);
    return (await res.json()) as { text?: string; words?: JobWord[] };
  }

  async getResult(taskId: string): Promise<ProviderResult> {
    const ids = taskId.split(TASK_SEP).filter(Boolean);

    // Моно: одна задача, говорящий не определён.
    if (ids.length < 2) {
      const st = await this.jobStatus(ids[0] ?? taskId);
      if (st.state !== 'done') {
        return st.state === 'failed'
          ? { status: 'failed', error: st.error ?? 'задача распознавания завершилась ошибкой' }
          : { status: 'processing' };
      }
      return { status: 'done', utterances: this.toUtterances(await this.jobResult(ids[0] ?? taskId), -1) };
    }

    // Стерео: ждём оба канала. Любой отказ — отказ целиком, иначе получили бы половину
    // разговора и выдали её за полную расшифровку.
    const states = await Promise.all(ids.map(id => this.jobStatus(id)));
    const failed = states.find(s => s.state === 'failed');
    if (failed) return { status: 'failed', error: failed.error ?? 'задача распознавания завершилась ошибкой' };
    if (states.some(s => s.state !== 'done')) return { status: 'processing' };

    const [first, second] = await Promise.all(ids.map(id => this.jobResult(id)));
    // Страховка от задвоения: если анализ каналов ошибся и в обоих один и тот же звук,
    // распознавание вернёт два одинаковых текста, и диалог удвоился бы целиком.
    if (this.looksDuplicated(first, second)) {
      this.logger.warn('Каналы записи оказались одинаковыми — отдаём один поток без разделения');
      return { status: 'done', utterances: this.toUtterances(first, -1) };
    }
    const merged = [...this.toUtterances(first, 0), ...this.toUtterances(second, 1)]
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    return { status: 'done', utterances: merged };
  }

  /** Похоже ли, что в двух каналах записан один и тот же звук (продублированное моно). */
  private looksDuplicated(a: { text?: string }, b: { text?: string }): boolean {
    const norm = (s?: string) =>
      (s || '').toLowerCase().replace(/[^а-яёa-z0-9\s]/gi, ' ').split(/\s+/).filter(Boolean);
    const wa = norm(a.text);
    const wb = norm(b.text);
    if (!wa.length || !wb.length) return false;
    const setB = new Map<string, number>();
    for (const w of wb) setB.set(w, (setB.get(w) ?? 0) + 1);
    let common = 0;
    for (const w of wa) {
      const left = setB.get(w) ?? 0;
      if (left > 0) {
        common++;
        setB.set(w, left - 1);
      }
    }
    return common / Math.max(wa.length, wb.length) >= DUPLICATE_RATIO;
  }

  /**
   * Собирает реплики из потока слов с таймкодами.
   *
   * speakerId: 0 и 1 для каналов стереозаписи (говорящий известен точно), -1 для моно —
   * честная пометка «говорящий не определён», по ней вёрстка печатает реплику с таймкодом,
   * но без ярлыка «Голос 1». Выдавать весь диалог за одного говорящего было бы ложью в
   * клиентском артефакте, который читает РОП.
   */
  private toUtterances(payload: { text?: string; words?: JobWord[] }, speakerId: number): Utterance[] {
    const words = Array.isArray(payload.words) ? payload.words.filter(w => this.clean(w.word)) : [];
    if (!words.length) {
      const text = this.clean(payload.text);
      return text ? [{ speakerId, text }] : [];
    }

    const utterances: Utterance[] = [];
    let parts: string[] = [];
    let start: number | undefined;
    let prevEnd: number | undefined;

    const flush = () => {
      const text = parts.join(' ').trim();
      if (text) utterances.push({ speakerId, text, start });
      parts = [];
      start = undefined;
    };

    for (const w of words) {
      const gap = prevEnd != null && w.start != null ? w.start - prevEnd : 0;
      if (parts.length && gap >= REPLICA_GAP_SEC) flush();
      if (!parts.length) start = w.start;
      parts.push(this.clean(w.word));
      prevEnd = w.end ?? w.start ?? prevEnd;
    }
    flush();
    return utterances;
  }

  /**
   * Модель иногда выдаёт «слова» из одних тире (маркер смены реплики в её обучающих данных).
   * В расшифровке они выглядят мусором: строки вида «[0:57] —». Плюс тире в клиентских
   * материалах у нас под запретом, а этот текст читает РОП и вставляет в разбор.
   */
  private clean(word?: string): string {
    return (word || '')
      .replace(/[—–]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
