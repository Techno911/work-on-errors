import client from './client';
import type { ReviewTemplate, ReviewTemplateHistory } from '@/types';

export const reviewTemplatesApi = {
  getAll: (companyId: string) =>
    client.get<ReviewTemplate[]>(`/companies/${companyId}/review-templates`),

  create: (companyId: string, data: { name: string; content: string }) =>
    client.post<ReviewTemplate>(`/companies/${companyId}/review-templates`, data),

  update: (companyId: string, id: string, data: { name?: string; content?: string; isActive?: boolean }) =>
    client.put<ReviewTemplate>(`/companies/${companyId}/review-templates/${id}`, data),

  deactivate: (companyId: string, id: string) =>
    client.delete(`/companies/${companyId}/review-templates/${id}`),

  getHistory: (companyId: string, id: string) =>
    client.get<ReviewTemplateHistory[]>(`/companies/${companyId}/review-templates/${id}/history`),
};
