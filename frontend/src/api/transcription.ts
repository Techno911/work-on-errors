import client from './client';
import type { TranscriptionUsage } from '@/types';

export const transcriptionApi = {
  getUsage: (companyId?: string) =>
    client.get<TranscriptionUsage>('/transcription/usage', { params: companyId ? { companyId } : undefined }),
  // Остаток минут для менеджера (своя компания) — до загрузки аудиофайла
  getMyUsage: () =>
    client.get<TranscriptionUsage>('/transcription/my/usage'),
};
