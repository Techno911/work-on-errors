import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { TranscriptionProvider, ProviderResult, Utterance } from './transcription-provider.interface';

// Переопределяются в env только для интеграционных тестов с мок-сервером
const OAUTH_URL = process.env.SALUTE_OAUTH_URL || 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API_BASE = process.env.SALUTE_API_BASE || 'https://smartspeech.sber.ru/rest/v1';

// Ответ data:download — массив фрагментов; структура у Сбера менялась, парсим толерантно.
interface SberRecognitionChunk {
  results?: { text?: string; normalized_text?: string; start?: string | number }[];
  speaker_info?: { speaker_id?: number };
  channel?: number;
  // Тайминг начала фрагмента: Сбер отдаёт строкой-длительностью («1.200s») или числом секунд.
  start?: string | number;
}

// «1.200s» / «12s» / 12.3 → секунды (число). Невалидное — undefined.
function parseStartSeconds(v: string | number | undefined): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/s$/, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * SaluteSpeech (Сбер), асинхронное распознавание файлов.
 * Флоу: OAuth (токен 30 мин) → data:upload → speech:async_recognize (диаризация 2 голоса)
 * → task:get поллинг → data:download. Файлы у Сбера автоудаляются через 72 ч.
 * Эндпоинты под сертификатами НУЦ Минцифры — в Docker-образе NODE_EXTRA_CA_CERTS.
 */
@Injectable()
export class SaluteSpeechProvider implements TranscriptionProvider {
  readonly name = 'salutespeech';
  private readonly logger = new Logger(SaluteSpeechProvider.name);
  private token: { value: string; expiresAt: number } | null = null;

  private get authKey(): string {
    return process.env.SALUTE_AUTH_KEY ?? '';
  }

  private get scope(): string {
    return process.env.SALUTE_SCOPE ?? 'SALUTE_SPEECH_PERS';
  }

  get enabled(): boolean {
    return this.authKey.length > 0;
  }

  private async getToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt) {
      return this.token.value;
    }
    const res = await fetch(OAUTH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.authKey}`,
        RqUID: randomUUID(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `scope=${this.scope}`,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SaluteSpeech OAuth ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { access_token: string; expires_at: number };
    // expires_at — unix ms; держим запас 60 секунд
    this.token = { value: data.access_token, expiresAt: data.expires_at - 60_000 };
    return data.access_token;
  }

  /** fetch с Bearer и одним повтором при 401 (протухший токен). */
  private async api(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(`${API_BASE}/${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
      await this.getToken(true);
      return this.api(path, init, false);
    }
    return res;
  }

  async createTask(audioFilePath: string): Promise<{ taskId: string }> {
    const { size } = await stat(audioFilePath);
    const uploadRes = await this.api('data:upload', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(size) },
      // ReadStream → duplex обязателен для стриминга тела в Node fetch
      body: createReadStream(audioFilePath) as unknown as BodyInit,
      duplex: 'half',
    } as RequestInit);
    if (!uploadRes.ok) {
      throw new Error(`SaluteSpeech upload ${uploadRes.status}: ${(await uploadRes.text()).slice(0, 200)}`);
    }
    const upload = (await uploadRes.json()) as { result?: { request_file_id?: string } };
    const fileId = upload.result?.request_file_id;
    if (!fileId) throw new Error('SaluteSpeech upload: нет request_file_id в ответе');

    const taskRes = await this.api('speech:async_recognize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        options: {
          language: 'ru-RU',
          audio_encoding: 'MP3',
          channels_count: 1,
          speaker_separation_options: { enable: true, enable_only_main_speaker: false, count: 2 },
        },
        request_file_id: fileId,
      }),
    });
    if (!taskRes.ok) {
      throw new Error(`SaluteSpeech async_recognize ${taskRes.status}: ${(await taskRes.text()).slice(0, 200)}`);
    }
    const task = (await taskRes.json()) as { result?: { id?: string } };
    if (!task.result?.id) throw new Error('SaluteSpeech async_recognize: нет id задачи');
    return { taskId: task.result.id };
  }

  async getResult(taskId: string): Promise<ProviderResult> {
    const res = await this.api(`task:get?id=${encodeURIComponent(taskId)}`);
    if (!res.ok) {
      return { status: 'failed', error: `SaluteSpeech task:get ${res.status}` };
    }
    const data = (await res.json()) as {
      result?: { status?: string; response_file_id?: string; error?: string };
    };
    const st = data.result?.status;
    if (st === 'NEW' || st === 'RUNNING') return { status: 'processing' };
    if (st !== 'DONE' || !data.result?.response_file_id) {
      return { status: 'failed', error: data.result?.error || `статус задачи: ${st ?? 'неизвестен'}` };
    }
    const dl = await this.api(`data:download?response_file_id=${encodeURIComponent(data.result.response_file_id)}`);
    if (!dl.ok) return { status: 'failed', error: `SaluteSpeech download ${dl.status}` };
    const chunks = (await dl.json()) as SberRecognitionChunk[];
    return { status: 'done', utterances: this.parseChunks(chunks) };
  }

  private parseChunks(chunks: SberRecognitionChunk[]): Utterance[] {
    const all = Array.isArray(chunks) ? chunks : [];
    // При включённой диаризации Сбер шлёт каждую фразу дважды: спикерский чанк
    // (speaker_id >= 0) и недиаризованный дубль (speaker_id = -1). Берём только спикерские,
    // иначе текст задваивается. Если диаризация не сработала (все -1) — берём как есть.
    const hasSpeakerChunks = all.some(c => (c.speaker_info?.speaker_id ?? -1) >= 0);
    const source = hasSpeakerChunks ? all.filter(c => (c.speaker_info?.speaker_id ?? -1) >= 0) : all;
    const utterances: Utterance[] = [];
    for (const chunk of source) {
      const text = chunk.results
        ?.map(r => (r.normalized_text || r.text || '').trim())
        .filter(Boolean)
        .join(' ');
      if (!text) continue;
      const start = parseStartSeconds(chunk.start) ?? parseStartSeconds(chunk.results?.[0]?.start);
      utterances.push({ speakerId: Math.max(0, chunk.speaker_info?.speaker_id ?? chunk.channel ?? 0), text, start });
    }
    return utterances;
  }
}
