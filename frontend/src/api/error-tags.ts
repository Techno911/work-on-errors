import client from './client';
import type { ErrorTag } from '@/types';

export const errorTagsApi = {
  getByCompany: (companyId: string) =>
    client.get<ErrorTag[]>('/error-tags', { params: { companyId } }),

  create: (data: { name: string; color: string; description?: string; companyId: string }) =>
    client.post<ErrorTag>('/error-tags', data),

  update: (id: string, data: { name?: string; color?: string; description?: string }) =>
    client.patch<ErrorTag>(`/error-tags/${id}`, data),

  delete: (id: string) =>
    client.delete(`/error-tags/${id}`),

  getUsage: (id: string) =>
    client.get<{ tagId: string; count: number }>(`/error-tags/${id}/usage`),
};
