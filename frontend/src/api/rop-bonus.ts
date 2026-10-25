import client from './client';
import type { RopBonusStats } from '@/types';

export const ropBonusApi = {
  getMonth: (companyId: string, period?: string) =>
    client.get<RopBonusStats>(`/rop-bonus/${companyId}`, {
      params: period ? { period } : undefined,
    }),
  getHistory: (companyId: string, months = 6) =>
    client.get<RopBonusStats[]>(`/rop-bonus/${companyId}/history`, {
      params: { months },
    }),
};
