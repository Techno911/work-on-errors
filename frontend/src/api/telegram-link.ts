import client from './client';

export interface TelegramLinkInfo {
  enabled: boolean;
  botUsername: string | null;
  deepLink: string | null;
  linked: boolean;
}

export const telegramLinkApi = {
  getMy: () => client.get<TelegramLinkInfo>('/telegram-link/me'),
  check: () => client.post<{ linked: boolean; autoWired: boolean; chatId: string | null }>('/telegram-link/check', {}),
};
