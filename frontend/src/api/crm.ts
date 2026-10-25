import client from './client';
import type { CrmConnectionView, CrmUpsertResult, CrmUser, CrmMyStatus, CrmCallListItem, StagedRecording, CrmHint } from '@/types';

export const crmApi = {
  // Подсказка команде клиента: CRM не подключена, а звонки носят руками.
  myHint: () => client.get<CrmHint>('/crm-integration/my/hint'),
  snoozeHint: () => client.post<{ snoozedUntil: string }>('/crm-integration/my/hint/snooze'),
  // owner / superadmin
  getConnection: (companyId: string) =>
    client.get<CrmConnectionView | null>(`/crm-integration/${companyId}`),
  upsert: (companyId: string, data: { provider: string; webhookUrl?: string; baseUrl?: string; secret?: string }) =>
    client.put<CrmUpsertResult>(`/crm-integration/${companyId}`, data),
  remove: (companyId: string) =>
    client.delete(`/crm-integration/${companyId}`),
  test: (companyId: string) =>
    client.post<{ ok: boolean; accountName?: string; errorCode?: string }>(`/crm-integration/${companyId}/test`),
  crmUsers: (companyId: string) =>
    client.get<CrmUser[]>(`/crm-integration/${companyId}/crm-users`),
  autoMap: (companyId: string) =>
    client.post<{ matched: number; unmatched: string[]; userMap: Record<string, string> }>(`/crm-integration/${companyId}/auto-map`),
  updateMapping: (companyId: string, userMap: Record<string, string>) =>
    client.put<Record<string, string>>(`/crm-integration/${companyId}/mapping`, { userMap }),
  // owner-онбординг: импорт выбранной команды из CRM + запрос помощи трекера
  importTeam: (companyId: string, members: Array<{ fullName: string; email: string; role: string }>) =>
    client.post<Array<{ fullName: string; email: string; role: string; tempPassword: string }>>(`/crm-integration/${companyId}/import-team`, { members }),
  requestHelp: (companyId: string) =>
    client.post<{ requested: boolean }>(`/crm-integration/${companyId}/request-help`),
  // Ссылка-поручение администратору CRM клиента: подключает портал сам, без входа в платформу.
  setupLink: (companyId: string, sendToChat: boolean) =>
    client.post<{ url: string; sentToChat: boolean; expiresAt: string }>(`/crm-integration/${companyId}/setup-link`, { sendToChat }),
  // Публичные ручки страницы /crm-setup/:token (открывает администратор CRM без авторизации)
  setupInfo: (token: string) =>
    client.get<{ companyName: string; alreadyConnected: boolean; provider: string | null }>(`/crm-setup/${token}`),
  setupSubmit: (token: string, data: { provider: string; webhookUrl?: string; baseUrl?: string; secret?: string }) =>
    client.post<{ ok: boolean; accountName?: string; errorCode?: string }>(`/crm-setup/${token}`, data),
  setupHelp: (token: string) =>
    client.post<{ requested: boolean }>(`/crm-setup/${token}/help`),
  // manager
  myStatus: () => client.get<CrmMyStatus>('/crm-integration/my/status'),
  myCalls: (params?: { from?: string; to?: string }) =>
    client.get<CrmCallListItem[]>('/crm-integration/my/calls', { params }),
  fetchCall: (callId: string, params?: { from?: string; to?: string }) =>
    client.post<StagedRecording>(`/crm-integration/my/calls/${callId}/fetch`, {}, { params }),
};
