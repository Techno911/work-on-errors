import client from './client';
import type { User } from '@/types';

export const usersApi = {
  changePassword: (currentPassword: string, newPassword: string) =>
    client.post('/users/me/password', { currentPassword, newPassword }),

  update: (id: string, dto: { fullName?: string; isActive?: boolean; role?: string; color?: string }) =>
    client.patch<User>(`/users/${id}`, dto),
  hardDelete: (id: string) =>
    client.delete(`/users/${id}/hard`),
  markOnboardingSeen: () =>
    client.post<User>('/users/me/onboarding-seen'),
  resetOnboarding: () =>
    client.post<User>('/users/me/onboarding-reset'),
  // «Что нового» прочитано до этой версии — окно не вернётся до следующего анонса.
  markReleasesSeen: (version: string) =>
    client.post<{ version: string }>('/users/me/releases-seen', { version }),
  // Личное скрытие/возврат карточки «Первые шаги» — лежит на сервере, переживает релогин.
  setFirstStepsHidden: (hidden: boolean) =>
    client.post<User>('/users/me/first-steps-hidden', { hidden }),
  // Личное согласие на ПДн + ознакомление с ЛНА — оба обязательны, гейтит первый вход РОПа/менеджера.
  submitPdnConsent: () =>
    client.post<{ recorded: boolean }>('/users/me/pdn-consent', { pdnConsent: true, lnaAcknowledged: true }),
  uploadAvatar: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return client.post<User>(`/users/${id}/avatar`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};
