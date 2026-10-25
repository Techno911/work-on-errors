import client from './client';

// Настройка премии в линейной модели (то, что предлагаем собственнику и что он подтверждает).
export interface RopBonusSetup {
  baseAmount: number;
  minThresholdPct: number;
  payoutDay: number | null;
  workdaysOnly: boolean;
}

export interface RopBonusOfferInfo {
  companyName: string;
  ropName: string;
  draft: RopBonusSetup | null;
  source: 'contract' | 'profile';
  status: 'draft' | 'sent' | 'accepted' | 'pending_review' | 'declined';
  responded: boolean;
  decision: 'recommended' | 'customized' | 'declined' | null;
}

export const ropBonusOfferApi = {
  // Публичная витрина предложения по токену (страница /rop-bonus-offer/:token).
  // Минимум данных: без ИНН, ФИО подписанта, адресов.
  getByToken: (token: string) =>
    client.get<RopBonusOfferInfo>(`/rop-bonus-offer/${token}`),

  // Принять рекомендованное (под входом собственника этой компании).
  accept: (token: string) =>
    client.post<{ alreadyResponded: boolean; decision: 'recommended' | 'customized' | 'declined' | null }>(
      `/rop-bonus-offer/${token}/accept`,
    ),

  // Настроить иначе — вариант собственника уходит трекеру на согласование (в прод не пишется).
  customize: (token: string, setup: Partial<RopBonusSetup>) =>
    client.post<{ alreadyResponded: boolean; decision: 'recommended' | 'customized' | 'declined' | null }>(
      `/rop-bonus-offer/${token}/customize`,
      setup,
    ),

  // Пока не вводим — осознанный отказ собственника.
  decline: (token: string) =>
    client.post<{ alreadyResponded: boolean; decision: 'recommended' | 'customized' | 'declined' | null }>(
      `/rop-bonus-offer/${token}/decline`,
    ),

  // Владелец в мастере онбординга (по своей companyId, без токена от трекера).
  getSelf: () =>
    client.get<{ draft: RopBonusSetup; ropName: string; responded: boolean; decision: 'recommended' | 'customized' | 'declined' | 'discuss' | null }>(
      '/rop-bonus-offer/self',
    ),
  acceptSelf: () =>
    client.post<{ alreadyResponded: boolean; decision: string | null }>('/rop-bonus-offer/self/accept'),
  discussSelf: () =>
    client.post<{ alreadyResponded: boolean; decision: string | null }>('/rop-bonus-offer/self/discuss'),
  // Премия не нужна: выключает премию и закрывает шаг дисциплины как осознанное решение.
  declineSelf: () =>
    client.post<{ alreadyResponded: boolean; decision: string | null }>('/rop-bonus-offer/self/decline'),
};
