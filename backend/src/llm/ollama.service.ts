import { Injectable, Logger } from '@nestjs/common';

// Своя LLM на сервере распознавания речи (Ollama, CPU-only) вместо платного API — по той же
// схеме, что уже работает для STT (см. gigaam.provider.ts): свой сервер, 0 ₽ за обращение.
// Модели выбраны исследованием 28.07.2026 под задачу «методичка сама находит повторы и пишет
// черновик правила»: qwen2.5:3b-instruct (Alibaba, Apache 2.0, ~1.9 ГБ) для генерации текста —
// на 5 vCPU без GPU отвечает за 10-15 секунд, что нормально для фоновой задачи, не для чата.
// bge-m3 (~1.2 ГБ) для эмбеддингов — та же модель, что уже крутится у РАГ, но отдельный
// инстанс через Ollama, чтобы не трогать инфраструктуру chirkov-rag.
// Ходим не в интернет, а в SSH-туннель (systemd-юнит ollama-tunnel на проде): наружу порт
// Ollama не выставлен, ключ на той стороне ограничен permitopen только портами 9876/11434.
const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const GENERATE_MODEL = process.env.OLLAMA_GENERATE_MODEL || 'qwen2.5:3b-instruct';
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'bge-m3';
// Генерация на CPU может занимать 10-20 секунд — таймаут с запасом, но не бесконечный:
// повисшая задача не должна держать очередь ревью.
const GENERATE_TIMEOUT_MS = 60_000;
const EMBED_TIMEOUT_MS = 20_000;

@Injectable()
export class OllamaService {
  private readonly logger = new Logger(OllamaService.name);

  get enabled(): boolean {
    return Boolean(BASE_URL);
  }

  /** Короткая генерация текста (черновик правила, вопрос аттестации, оценка ответа). */
  async generate(prompt: string, opts: { maxTokens?: number; temperature?: number } = {}): Promise<string | null> {
    try {
      const res = await fetch(`${BASE_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: GENERATE_MODEL,
          prompt,
          stream: false,
          options: {
            num_predict: opts.maxTokens ?? 300,
            temperature: opts.temperature ?? 0.3, // низкая — держим модель ближе к фактам разбора, не фантазирует
          },
        }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Ollama generate ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { response?: string };
      return data.response?.trim() || null;
    } catch (e) {
      this.logger.warn(`Ollama generate недоступна: ${(e as Error).message}`);
      return null;
    }
  }

  /** Вектор эмбеддинга текста (1024 числа у bge-m3) для семантического сравнения. */
  async embed(text: string): Promise<number[] | null> {
    const clean = text.trim();
    if (!clean) return null;
    try {
      const res = await fetch(`${BASE_URL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: EMBED_MODEL, prompt: clean }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`Ollama embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { embedding?: number[] };
      return Array.isArray(data.embedding) && data.embedding.length ? data.embedding : null;
    } catch (e) {
      this.logger.warn(`Ollama embeddings недоступна: ${(e as Error).message}`);
      return null;
    }
  }
}
