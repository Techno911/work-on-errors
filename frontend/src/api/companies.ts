import client from './client';
import type { User, CompanySettings, UpdateCompanySettingsDto } from '@/types';

export const companiesApi = {
  getById: (companyId: string) =>
    client.get<{ id: string; name: string }>(`/companies/${companyId}`),

  // Состояние доступа своей компании. Остаётся открытым при приостановке за неоплату: из него
  // рисуется экран с объяснением. Пояснение (счёт, период) приходит только собственнику.
  getAccessState: () =>
    client.get<{
      companyName?: string;
      paymentHold: boolean;
      since: string | null;
      note: string | null;
    }>(`/companies/access-state`),

  getSettings: (companyId: string) =>
    client.get<CompanySettings>(`/companies/${companyId}/settings`),

  // Справочник готовых режимов нормативов (единый источник для владельца и трекера).
  getNormPresets: () =>
    client.get<{ name: 'soft' | 'standard' | 'strict'; label: string; tone: string; data: Record<string, unknown> }[]>(
      `/companies/norm-presets`,
    ),

  update: (companyId: string, data: UpdateCompanySettingsDto | Record<string, unknown>) =>
    client.patch<{ id: string }>(`/companies/${companyId}`, data),

  getUsers: (companyId: string) =>
    client.get<User[]>(`/users`, { params: { companyId } }),

  updateGamification: (
    companyId: string,
    data: { gamificationEnabled?: boolean; reviewerCanEditGamification?: boolean },
  ) => client.patch(`/companies/${companyId}/gamification`, data),
};
