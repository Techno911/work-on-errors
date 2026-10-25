import client from './client';

export const offerApi = {
  // Публичная витрина оферты по токену (страница /offer/:token до логина).
  // legalName/inn — реквизиты заказчика-юрлица из договора (если внесены).
  getByToken: (token: string) =>
    client.get<{ companyName: string; accepted: boolean; legalName: string | null; inn: string | null; trialDays: number; licenseMode: 'trial' | 'implementation'; trialEndsAt: string | null; workStartedAt: string | null }>(`/offer/${token}`),

  // Принятие оферты текущим (только что зарегистрированным) пользователем.
  // pdnConsent — отдельный обязательный флаг согласия на ПДн (свой чекбокс, не подразумевается офертой).
  accept: (token: string, pdnConsent: boolean) =>
    client.post<{ success: boolean; trialEndsAt: string }>(`/offer/${token}/accept`, { pdnConsent }),
};
