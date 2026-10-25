import client from './client';
import type { RopBonusSetup } from './rop-bonus-offer';

// Жизненный статус компании (операционный бейдж трекера).
export type CompanyStatus = 'launch' | 'active' | 'paused' | 'closed' | 'demo';

export interface AdminCompanyMetrics {
  id: string;
  name: string;
  status: CompanyStatus;
  onboardingCompleted: boolean;
  offerAccepted: boolean;
  offerPending: boolean;
  managersCount: number;
  reviewersCount: number;
  ownersCount: number;
  currentSprint: {
    label: string;
    status: string;
    completionRate: number;
    entriesCount: number;
    reviewedCount: number;
    totalExpected: number;
  } | null;
  health: 'good' | 'warning' | 'critical';
  lastActivityAt: string | null;
  daysQuiet: number | null;
  pendingReviews: number;
  reviewCoverage: number | null;
  loopProtected: boolean;
  loopProtectionReasons: string[];
  teamStreak: number;
  teamStreakHasTeam: boolean;
  ropBonusForecast: { onTimePct: number | null; currentAmount: number } | null;
  computedHealth: ComputedHealth;
  pauseInfo: PauseInfo | null;
}

// Условия паузы: без них пауза это ярлык без срока (случай клиента, 112 дней).
export interface PauseInfo {
  reason?: string;
  startedAt?: string;
  expectedReturnAt?: string;
  responsible?: string;
  conditionToEnd?: string;
}

// Приостановка за неоплату: когда включили, кто, что видит собственник, когда сняли.
export interface PaymentHoldInfo {
  startedAt?: string;
  note?: string;
  byUserId?: string;
  byLabel?: string;
  liftedAt?: string;
}

export interface LegalInfo {
  legalName?: string;
  inn?: string;
  kpp?: string;
  ogrn?: string;
  address?: string;
  signatory?: string;
  contractFileName?: string;
  contractStoredName?: string;
  contractUploadedAt?: string;
}

export interface AdminCompanyDetails {
  company: {
    id: string;
    name: string;
    status: CompanyStatus;
    licenseMode?: 'trial' | 'implementation';
    callsPerWeek: number;
    chatsPerWeek: number;
    callsEnabled: boolean;
    chatsEnabled: boolean;
    onboardingCompleted: boolean;
    // Приходят в payload (полная сущность компании) — нужны для плашки готовности пространства.
    reportChannels?: { weeklyAccountability?: { emails?: string[]; telegramChatIds?: string[] } };
    ropBonus?: { enabled?: boolean; declinedExplicitly?: boolean; baseAmount?: number | null; minThresholdPct?: number | null; payoutDay?: number | null };
    // Предложение премии РОПа собственнику: черновик трекера → ссылка-лендинг → ответ владельца.
    ropBonusProposal?: {
      token?: string | null;
      status?: 'draft' | 'sent' | 'accepted' | 'pending_review' | 'declined';
      draft?: RopBonusSetup;
      ownerVariant?: RopBonusSetup | null;
      source?: 'contract' | 'profile';
      sentAt?: string | null;
      respondedAt?: string | null;
      decision?: 'recommended' | 'customized' | 'declined' | 'discuss' | 'agreed' | null;
    };
    // Онбординг-оферта и триал (заход 1-2).
    offerToken?: string | null;
    offerAcceptedAt?: string | null;
    trialEndsAt?: string | null;
    // Старт работы из рабочего ТГ-чата (или вручную) + привязка чата (заход 3).
    workStartedAt?: string | null;
    telegramWorkChatId?: string | null;
    telegramBindCode?: string | null;
    // Фаза «Запуск»: момент kick-off сообщения команде (null = ещё не запускали).
    launchedAt?: string | null;
    trialDays?: number;
    // Реквизиты юрлица/ИП заказчика + метаданные загруженного договора.
    legalInfo?: LegalInfo;
    // Условия паузы (пусто, если компания не на паузе).
    pauseInfo?: PauseInfo;
    // Приостановка за неоплату: отдельно от статуса и от паузы (см. PaymentHoldInfo).
    paymentHold?: boolean;
    paymentHoldInfo?: PaymentHoldInfo;
    // «CRM подключать нечем»: выключает напоминания команде о подключении.
    crmNotApplicable?: boolean;
    crmNotApplicableInfo?: { reason?: string; markedBy?: string; markedAt?: string };
  };
  managersProgress: Array<{
    id: string;
    fullName: string;
    email: string;
    color: string | null;
    entriesCount: number;
    submittedCount: number;
    reviewedCount: number;
  }>;
  sprint: { id: string; label: string; status: string } | null;
  // Здоровье работы по фактам, рядом с ручным статусом.
  computedHealth: ComputedHealth;
  // Чек-лист запуска: факты первого оборота петли (не настройки).
  launch: {
    teamEntered: boolean;
    hasEntry: boolean;
    hasSelfReview: boolean;
    hasReview: boolean;
    // Стартовое сообщение собирается на бэке целиком: черновик + хвост с доступами в том виде,
    // в каком он уйдёт в чат. Своей копии текста фронт не держит.
    draftDefault: string;
    accessPreview: string;
  };
}

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  color: string | null;
  createdAt: string;
  // true = ни разу не входил (бейдж «ещё не входил» + кнопка «Доступ в чат»).
  neverLoggedIn?: boolean;
  // Личная привязка к Telegram-боту: без неё РОП не получает утренний дайджест.
  telegramLinked?: boolean;
}

export interface CreateAdminUserDto {
  fullName: string;
  email: string;
  role: string;
}

/** Состояние сторожа: когда отработал и что у него сейчас открыто (экран вместо свода в Telegram). */
export interface WatchdogState {
  key: string;
  label: string;
  lastRunAt: string | null;
  lastSentAt: string | null;
  silentHours: number | null;
  overdue: boolean;
  openSignals: { text: string; firstSeenAt: string; lastSentAt: string }[];
}

export const adminApi = {
  getWatchdogs: () => client.get<{ watchdogs: WatchdogState[] }>('/admin/watchdogs'),
  getCompanies: () => client.get<AdminCompanyMetrics[]>('/admin/companies'),
  getCompanyDetails: (id: string) => client.get<AdminCompanyDetails>(`/admin/companies/${id}/details`),
  setCompanyStatus: (companyId: string, status: CompanyStatus) =>
    client.patch<{ id: string; status: CompanyStatus }>(`/admin/companies/${companyId}/status`, { status }),
  setLicenseMode: (companyId: string, mode: 'trial' | 'implementation') =>
    client.patch<{ id: string; licenseMode: 'trial' | 'implementation' }>(`/admin/companies/${companyId}/license-mode`, { mode }),
  createCompany: (dto: {
    name: string;
    timezone?: string;
    callsPerWeek?: number;
    chatsPerWeek?: number;
    callsEnabled?: boolean;
    chatsEnabled?: boolean;
  }) => client.post<{ id: string; name: string; offerToken: string | null }>('/admin/companies', dto),
  getCompanyUsers: (companyId: string) =>
    client.get<AdminUser[]>(`/admin/companies/${companyId}/users`),
  createCompanyUser: (companyId: string, dto: CreateAdminUserDto) =>
    // Пароль больше не возвращается: человек задаёт его сам по именной ссылке.
    client.post<{ user: AdminUser; activationUrl: string }>(`/admin/companies/${companyId}/users`, dto),
  resetUserPassword: (userId: string) =>
    client.post<{ userId: string; newPassword: string }>(`/admin/users/${userId}/reset-password`, {}),
  impersonate: (userId: string) =>
    client.post<{ accessToken: string; user: import('@/types').User }>(`/admin/users/${userId}/impersonate`, {}),
  removeCompanyUser: (companyId: string, userId: string) =>
    client.delete<{ removed: boolean }>(`/admin/companies/${companyId}/users/${userId}`),
  deleteCompany: (companyId: string) =>
    client.delete<{ deleted: boolean }>(`/admin/companies/${companyId}`),
  ensureOfferLink: (companyId: string) =>
    client.post<{ offerToken: string | null; alreadyAccepted: boolean }>(`/admin/companies/${companyId}/offer-link`, {}),
  ensureBindCode: (companyId: string) =>
    client.post<{ bindCode: string | null; botUsername: string | null; chatId: string | null }>(`/admin/companies/${companyId}/telegram-bind-code`, {}),
  setWorkStart: (companyId: string, date: string) =>
    client.post<{ id: string; workStartedAt: string | null; trialEndsAt: string | null }>(`/admin/companies/${companyId}/work-start`, { date }),
  launchCompany: (companyId: string, message: string) =>
    client.post<{ launchedAt: string }>(`/admin/companies/${companyId}/launch`, { message }),
  // Перезапуск после простоя: новая точка отсчёта и сторож тишины заново.
  relaunchCompany: (companyId: string, message: string) =>
    client.post<{ launchedAt: string }>(`/admin/companies/${companyId}/relaunch`, { message }),
  // Пауза с условиями (причина, дата возврата, ответственный) и снятие паузы.
  pauseCompany: (companyId: string, dto: { reason: string; expectedReturnAt: string; responsible?: string; conditionToEnd?: string }) =>
    client.post<{ id: string; status: CompanyStatus }>(`/admin/companies/${companyId}/pause`, dto),
  resumeCompany: (companyId: string) =>
    client.post<{ id: string; status: CompanyStatus }>(`/admin/companies/${companyId}/resume`, {}),
  // Приостановка работы за неоплату и её снятие (только суперадмин). Это не пауза: пауза
  // приглушает наши сообщения, приостановка закрывает работу команде клиента.
  holdForPayment: (companyId: string, note?: string) =>
    client.post<{ id: string; paymentHold: boolean }>(`/admin/companies/${companyId}/payment-hold`, { note }),
  releasePaymentHold: (companyId: string) =>
    client.delete<{ id: string; paymentHold: boolean }>(`/admin/companies/${companyId}/payment-hold`),
  // Отметка «CRM подключать нечем»: гасит напоминания команде клиента. Причина обязательна,
  // иначе через полгода никто не вспомнит, почему шаг пропущен.
  setCrmNotApplicable: (companyId: string, notApplicable: boolean, reason?: string) =>
    client.post<{ id: string }>(`/admin/companies/${companyId}/crm-not-applicable`, { notApplicable, reason }),
  // Журнал событий компании: что происходило и доходили ли сигналы.
  getCompanyEvents: (companyId: string) =>
    client.get<CompanyEventItem[]>(`/admin/companies/${companyId}/events`),
  // Трекер применяет готовый режим нормативов (значения берутся на бэке, произвольный набор
  // прислать нельзя). Справочник режимов — companiesApi.getNormPresets().
  applyNormPreset: (companyId: string, preset: 'soft' | 'standard' | 'strict') =>
    client.post<{ applied: string; label: string }>(`/admin/companies/${companyId}/norm-preset`, { preset }),

  sendUserAccess: (userId: string) =>
    client.post<{ sent: boolean }>(`/admin/users/${userId}/send-access`, {}),
  listDetectedChats: () =>
    client.get<Array<{ chatId: string; title: string | null; isAdmin: boolean }>>(`/admin/telegram/detected-chats`),
  pollTelegram: () => client.post<{ ok: boolean }>(`/admin/telegram/poll`, {}),
  bindChat: (companyId: string, chatId: string) =>
    client.post<{ id: string; telegramWorkChatId: string | null }>(`/admin/companies/${companyId}/bind-chat`, { chatId }),
  saveLegalInfo: (companyId: string, dto: Partial<Pick<LegalInfo, 'legalName' | 'inn' | 'kpp' | 'ogrn' | 'address' | 'signatory'>>) =>
    client.patch<{ id: string; legalInfo: LegalInfo }>(`/admin/companies/${companyId}/legal-info`, dto),
  uploadContract: (companyId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    // multipart/form-data обязателен: у client дефолтный Content-Type application/json,
    // без этой строки axios не проставит boundary и multer не увидит файл (как в entries/users).
    return client.post<{ id: string; legalInfo: LegalInfo }>(`/admin/companies/${companyId}/contract`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Договор содержит ПД → грузим blob с Bearer-токеном, затем сохраняем через objectURL.
  getContractBlob: (companyId: string) =>
    client.get<Blob>(`/admin/companies/${companyId}/contract`, { responseType: 'blob' }),
  // Трекер готовит предложение премии РОПа собственнику и получает токен ссылки-лендинга.
  prepareRopBonusProposal: (companyId: string, draft: RopBonusSetup, source: 'contract' | 'profile') =>
    client.post<{ token: string }>(`/admin/companies/${companyId}/rop-bonus-proposal`, { draft, source }),
  // Трекер применяет вариант собственника («настроить иначе») после согласования.
  applyRopBonusOwnerVariant: (companyId: string) =>
    client.post<{ applied: boolean }>(`/admin/companies/${companyId}/rop-bonus-proposal/apply`, {}),
  // Item 5: трекер вносит согласованные с собственником условия напрямую — премия подключается сразу.
  applyRopBonusAgreed: (companyId: string, setup: RopBonusSetup) =>
    client.post<{ applied: boolean }>(`/admin/companies/${companyId}/rop-bonus-agreed`, setup),

  // ── Управление трекерами (только суперадмин) ──
  listTrackers: () => client.get<TrackerInfo[]>(`/admin/trackers`),
  createTracker: (dto: { fullName: string; email: string }) =>
    client.post<{ tracker: TrackerInfo; tempPassword: string }>(`/admin/trackers`, dto),
  setTrackerActive: (id: string, isActive: boolean) =>
    client.patch<{ id: string; isActive: boolean }>(`/admin/trackers/${id}/active`, { isActive }),
  // Полное удаление трекера (необратимо): освобождает email под новый аккаунт.
  deleteTracker: (id: string) =>
    client.delete<{ deleted: boolean }>(`/admin/trackers/${id}`),
};

// Событие журнала компании (волна 2 разбора жизненного цикла).
export interface CompanyEventItem {
  id: string;
  type: string;
  title: string;
  details: string | null;
  actorLabel: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

// Здоровье работы: считает система по фактам, показывается рядом с ручным статусом.
export interface ComputedHealth {
  state: 'not_started' | 'ramping' | 'running' | 'lagging' | 'silent';
  label: string;
  detail: string;
  days: number;
  mismatch: boolean;
  mismatchText: string | null;
}

export interface TrackerInfo {
  id: string;
  fullName: string;
  email: string;
  isActive: boolean;
  createdAt: string;
}
