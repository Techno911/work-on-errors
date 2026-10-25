import client from './client';
import type { PlaybookCard, PlaybookProgress } from '@/types';

export const playbookApi = {
  getActiveCards: (companyId: string) =>
    client.get<PlaybookCard[]>('/playbook/cards', { params: { companyId } }),

  getCandidates: (companyId: string) =>
    client.get<PlaybookCard[]>('/playbook/candidates', { params: { companyId } }),

  getProgress: (companyId: string) =>
    client.get<PlaybookProgress>('/playbook/progress', { params: { companyId } }),

  getExportData: (companyId: string) =>
    client.get<Array<{ title: string; ruleText: string | null; examples: PlaybookCard['examples']; occurrenceCount: number; ownerName: string | null; confirmedAt: string | null }>>(
      '/playbook/export',
      { params: { companyId } },
    ),

  confirm: (companyId: string, id: string, data: { title?: string; ruleText: string }) =>
    client.post<PlaybookCard>(`/playbook/candidates/${id}/confirm`, data, { params: { companyId } }),

  dismiss: (companyId: string, id: string, data: { reason?: string } = {}) =>
    client.post<PlaybookCard>(`/playbook/candidates/${id}/dismiss`, data, { params: { companyId } }),

  archive: (companyId: string, id: string, data: { reason?: string } = {}) =>
    client.post<PlaybookCard>(`/playbook/cards/${id}/archive`, data, { params: { companyId } }),

  update: (companyId: string, id: string, data: { title?: string; ruleText?: string; examples?: PlaybookCard['examples'] }) =>
    client.patch<PlaybookCard>(`/playbook/cards/${id}`, data, { params: { companyId } }),

  createManual: (companyId: string, data: { title: string; ruleText?: string }) =>
    client.post<PlaybookCard>('/playbook/cards', data, { params: { companyId } }),
};
