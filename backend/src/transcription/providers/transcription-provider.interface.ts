// Абстракция STT-провайдера: сейчас SaluteSpeech, кандидат на пилот — T-Bank VoiceKit.
// Контракт асинхронный: создали задачу → периодически спрашиваем результат.

export interface Utterance {
  speakerId: number;
  text: string;
  /** Начало реплики в секундах от старта записи (если провайдер вернул тайминг). */
  start?: number;
}

export type ProviderResult =
  | { status: 'processing' }
  | { status: 'done'; utterances: Utterance[] }
  | { status: 'failed'; error: string };

export interface TranscriptionProvider {
  readonly name: string;
  /** Сервис сконфигурирован (ключи заданы в env). */
  readonly enabled: boolean;
  /** Загружает файл провайдеру и создаёт задачу распознавания. Файл — моно MP3. */
  createTask(audioFilePath: string): Promise<{ taskId: string }>;
  getResult(taskId: string): Promise<ProviderResult>;
}

export const TRANSCRIPTION_PROVIDER = Symbol('TRANSCRIPTION_PROVIDER');
