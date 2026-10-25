import client from './client';
import type { Entry, EntryScreenshot, EntryAudio, CreateEntryDto, UpdateEntryDto, ErrorTag, ManagerRepeat } from '@/types';

export const entriesApi = {
  getAll: (params: { sprintId?: string; managerId?: string; companyId?: string; status?: Entry['status'] }) =>
    client.get<Entry[]>(`/entries`, { params }),
  getById: (id: string) =>
    client.get<Entry>(`/entries/${id}`),
  create: (data: CreateEntryDto) =>
    client.post<Entry>(`/entries`, data),
  update: (id: string, data: UpdateEntryDto) =>
    client.patch<Entry>(`/entries/${id}`, data),
  submit: (id: string) =>
    client.patch<Entry>(`/entries/${id}/submit`),
  review: (id: string, data: { reviewText: string; tagIds: string[] }) =>
    client.patch<Entry>(`/entries/${id}/review`, data),
  // Повторы ошибок этого менеджера за шесть недель: «эта ошибка у него третий раз».
  repeats: (id: string) =>
    client.get<ManagerRepeat[]>(`/entries/${id}/repeats`),
  // Личное подтверждение чтения разбора: возвращаем серверный хеш прочитанной
  // версии + наблюдаемый штамп последнего перечитывания (CAS против ретрая).
  confirmReview: (id: string, expectedHash: string, lastSeenRereadAt: string | null) =>
    client.patch<{ reviewConfirmedAt: string | null; reviewRereadAt: string | null; reviewConfirmedHash: string; reviewTextHash: string }>(
      `/entries/${id}/review-confirm`, { expectedHash, lastSeenRereadAt }),
  // Подборка прежних разборов менеджера перед новой записью: reviewedAt DESC, offset-догрузка.
  getRecentReviews: (params: { managerId?: string; limit?: number; offset?: number; order?: 'reviewedAt'; requireText?: boolean }) =>
    client.get<Entry[]>(`/entries/recent-reviews`, { params }),
  setTags: (id: string, tagIds: string[]) =>
    client.patch<Entry>(`/entries/${id}/tags`, { tagIds }),
  delete: (id: string) =>
    client.delete(`/entries/${id}`),
  uploadScreenshots: (id: string, files: File[]) => {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));
    return client.post<EntryScreenshot[]>(`/entries/${id}/screenshots`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  deleteScreenshot: (entryId: string, screenshotId: string) =>
    client.delete(`/entries/${entryId}/screenshots/${screenshotId}`),
  uploadAudio: (id: string, file: File, onProgress?: (pct: number) => void) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post<EntryAudio>(`/entries/${id}/audio`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: e => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100));
      },
    });
  },
  getAudio: (id: string) =>
    client.get<EntryAudio | null>(`/entries/${id}/audio`),
  // Запись звонка — ПД клиента, отдаётся авторизованным стримом (не публичной статикой).
  // Грузим blob с Bearer-токеном, затем показываем через objectURL.
  getAudioBlob: (id: string) =>
    client.get<Blob>(`/entries/${id}/audio/stream`, { responseType: 'blob' }),
  applyAudioTranscription: (id: string) =>
    client.post<Entry>(`/entries/${id}/audio/apply`),
  deleteAudio: (id: string) =>
    client.delete(`/entries/${id}/audio`),
  // Скриншот переписки — ПД клиента, авторизованная отдача (не публичная статика).
  getScreenshotBlob: (entryId: string, screenshotId: string) =>
    client.get<Blob>(`/entries/${entryId}/screenshots/${screenshotId}/file`, { responseType: 'blob' }),
};

export const errorTagsApi = {
  getAll: (companyId: string) =>
    client.get<ErrorTag[]>(`/error-tags`, { params: { companyId } }),
  create: (data: { companyId: string; name: string; color?: string }) =>
    client.post<ErrorTag>(`/error-tags`, data),
};
