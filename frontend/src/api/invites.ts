import client from './client';
import type { Invite } from '@/types';

export const invitesApi = {
  create: (data: { email: string; fullName?: string; role?: string; companyId: string }) =>
    client.post<Invite>('/invites', data),

  getByCode: (code: string) =>
    client.get<Invite>(`/invites/${code}`),

  accept: (code: string) =>
    client.post<{ success: boolean }>(`/invites/${code}/accept`),

  getByCompany: (companyId: string) =>
    client.get<Invite[]>('/invites', { params: { companyId } }),
};
