export interface User {
  id: string;
  email: string;
  fullName: string;
  role: 'superadmin' | 'tracker' | 'owner' | 'reviewer' | 'manager';
  companyId: string | null;
  color: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  onboardingSeenAt: string | null;
  // Последняя версия, анонс которой человек прочитал в окне «Что нового».
  releasesSeenVersion: string | null;
  // Личное скрытие карточки «Первые шаги» на главной. null = не скрывал.
  firstStepsHiddenAt: string | null;
  createdAt: string;
  // paymentHold приходит вместе с профилем: по нему экран приостановки поднимается до первого
  // рендера страниц, а не после череды отказов сервера.
  company?: { id: string; name: string; paymentHold?: boolean } | null;
  pdnConsentAcceptedAt: string | null;
  lnaAcknowledgedAt: string | null;
}

export interface Company {
  id: string;
  name: string;
  logoUrl: string | null;
  callsPerWeek: number;
  chatsPerWeek: number;
  managerDeadlineDay: string;
  reviewerDeadlineDay: string;
  isActive: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

// ==================== SPRINT TYPES ====================

export type SprintStatus = 'active' | 'completed' | 'archived';
export type EntryType = 'call' | 'chat';
export type EntryStatus = 'draft' | 'submitted' | 'reviewed';

export interface Sprint {
  id: string;
  companyId: string;
  startDate: string;
  endDate: string;
  label: string;
  status: SprintStatus;
  entries: Entry[];
  createdAt: string;
  updatedAt: string;
}

export interface ErrorTag {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  color: string;
  createdAt: string;
}

export interface EntryScreenshot {
  id: string;
  entryId: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  sortOrder: number;
  createdAt: string;
}

export interface Entry {
  id: string;
  sprintId: string;
  managerId: string;
  manager: User;
  companyId: string;
  type: EntryType;
  entryNumber: number;
  entryDate: string;
  source?: string;
  sourceCustom?: string;
  transcription?: string;
  selfReviewCorrect?: string;
  selfReviewImprove?: string;
  selfReviewSuggestions?: string;
  reviewText?: string;
  // Версия текста разбора (sha256 на сервере) и личная отметка менеджера о чтении:
  // хеш подтверждённой версии, первое подтверждение и последнее перечитывание.
  reviewTextHash?: string | null;
  reviewConfirmedHash?: string | null;
  reviewConfirmedAt?: string | null;
  reviewRereadAt?: string | null;
  reviewerId?: string;
  reviewer?: User;
  submittedAt?: string;
  reviewedAt?: string;
  status: EntryStatus;
  errorTags: ErrorTag[];
  screenshots: EntryScreenshot[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Повторяющаяся ошибка одного менеджера за окно методички (шесть недель).
 * Отвечает на вопрос руководителя «применили ли они то, что я уже говорил».
 */
export interface ManagerRepeat {
  tagId: string;
  tagName: string;
  count: number;
  lastEntries: { entryId: string; entryNumber: number; sprintId: string; entryDate: string }[];
}

export interface CreateEntryDto {
  sprintId: string;
  managerId: string;
  companyId: string;
  type: EntryType;
  entryNumber: number;
  entryDate: string;
  source?: string;
  sourceCustom?: string;
  transcription?: string;
  stagedRecordingId?: string;
  crmCallId?: string;
  crmProvider?: string;
  crmCallMetadata?: { phone?: string; direction?: string; durationSec?: number; callStartedAt?: string };
}

export interface UpdateEntryDto {
  transcription?: string;
  selfReviewCorrect?: string;
  selfReviewImprove?: string;
  selfReviewSuggestions?: string;
  source?: string;
  sourceCustom?: string;
  entryDate?: string;
}

// ==================== GAMIFICATION CONFIG ====================

export interface XpSettings {
  entrySubmitted: number;
  selfReviewComplete: number;
  reviewReceived: number;
  reviewNoErrors: number;
  weeklyGoodZone: number;
  weeklyGreatZone: number;
  streakBonus: number;
}

export interface AchievementSettings {
  sniperThreshold: number;
  writerThreshold: number;
  great3xThreshold: number;
  streak7Threshold: number;
  streak30Threshold: number;
}

export interface GamificationConfig {
  xpSettings: XpSettings;
  achievementSettings: AchievementSettings;
}

// ==================== COMPANY SETTINGS ====================

export interface ReviewNorms {
  minReviewsPerWeek: number;
  maxHoursToRespond: number;
  minReviewCharsAvg: number;
  qualityThresholdPct: number;
}

// Единый дефолт нормативов ревью (зеркало DEFAULT_REVIEW_NORMS на бэке).
// Срок разбора 24 часа — решение владельца продукта.
export const DEFAULT_REVIEW_NORMS: ReviewNorms = {
  minReviewsPerWeek: 0,
  maxHoursToRespond: 24,
  minReviewCharsAvg: 150,
  qualityThresholdPct: 80,
};

export interface ReportChannels {
  weeklyAccountability?: {
    emails?: string[];
    telegramChatIds?: string[];
  };
}

// Премия РОПа за работу над ошибками
export interface RopBonusTier {
  thresholdPct: number;
  amount: number;
}

export interface RopBonusData {
  enabled: boolean;
  tiers: RopBonusTier[];
  // Линейная модель по договору (Приложение № 3): премия = baseAmount × (% ревью в срок),
  // если % ≥ minThresholdPct, иначе 0. baseAmount задан → линейный режим (приоритет над tiers).
  baseAmount?: number | null;
  minThresholdPct?: number | null; // отсечка (дефолт 60): ниже — премия 0
  payoutDay?: number | null; // день месяца (1–28) отправки расчёта за прошлый месяц
  workdaysOnly?: boolean;    // срок в рабочих днях: дедлайн с выходных переносится на понедельник
  declinedExplicitly?: boolean; // владелец осознанно отказался от премии как контура дисциплины
}

export interface RopBonusStats {
  period: string; // YYYY-MM
  enabled: boolean;
  // Режим расчёта: 'linear' — база×% (по договору), 'tiers' — ступени (легаси).
  mode?: 'linear' | 'tiers';
  baseAmount?: number | null;
  minThresholdPct?: number | null;
  tiers: RopBonusTier[];
  maxHoursToRespond: number;
  onTimeCount: number;
  lateCount: number;
  shortCount?: number;
  pendingCount: number;
  onTimePct: number | null;
  bestCasePct: number | null;
  minReviewChars?: number;
  currentAmount: number;
  currentTier: RopBonusTier | null;
  bestCaseAmount: number;
  bestCaseTier: RopBonusTier | null;
  nextTier: RopBonusTier | null;
  daysLeftInMonth: number;
  payoutDay?: number | null;
  ropName?: string | null;
  frozen?: boolean;
  frozenAt?: string | null;
}

export interface CompanySettings {
  timezone?: string;
  callsEnabled: boolean;
  chatsEnabled: boolean;
  callsPerWeek: number;
  chatsPerWeek: number;
  minSelfReviewCorrectChars: number;
  minSelfReviewImproveChars: number;
  minSelfReviewSuggestionsChars: number;
  minReviewChars: number;
  onboardingCompleted?: boolean;
  thresholdGoodCalls: number;
  thresholdGoodChats: number;
  thresholdGreatCalls: number;
  thresholdGreatChats: number;
  callSources: string[];
  chatSources: string[];
  gamificationEnabled: boolean;
  reviewerCanEditGamification: boolean;
  reviewerCanEditReviewTemplates?: boolean;
  managerDeadlineDay?: string;
  reviewerDeadlineDay?: string;
  xpSettings: XpSettings;
  achievementSettings: AchievementSettings;
  reviewNorms?: ReviewNorms;
  reportChannels?: ReportChannels;
  ropBonus?: RopBonusData;
  transcription?: TranscriptionSettingsData | null;
}

export interface UpdateCompanySettingsDto {
  timezone?: string;
  callsEnabled?: boolean;
  chatsEnabled?: boolean;
  callsPerWeek?: number;
  chatsPerWeek?: number;
  minSelfReviewCorrectChars?: number;
  minSelfReviewImproveChars?: number;
  minSelfReviewSuggestionsChars?: number;
  minReviewChars?: number;
  name?: string;
  thresholdGoodCalls?: number;
  thresholdGoodChats?: number;
  thresholdGreatCalls?: number;
  thresholdGreatChats?: number;
  callSources?: string[];
  chatSources?: string[];
  gamificationEnabled?: boolean;
  reviewerCanEditGamification?: boolean;
  reviewerCanEditReviewTemplates?: boolean;
  reviewNorms?: ReviewNorms;
  reportChannels?: ReportChannels;
  ropBonus?: RopBonusData;
  transcription?: TranscriptionSettingsData;
}

// ==================== TRANSCRIPTION ====================

export interface TranscriptionSettingsData {
  enabled: boolean;
  monthlyMinutesLimit: number | null;
}

export type EntryAudioStatus = 'converting' | 'queued' | 'transcribing' | 'done' | 'failed';

export interface EntryAudio {
  id: string;
  entryId: string;
  fileUrl: string;
  originalFileName: string;
  fileSize: number;
  durationSec: number;
  status: EntryAudioStatus;
  errorMessage: string | null;
  transcriptionResult: string | null;
  appliedAt: string | null;
  createdAt: string;
}

export interface TranscriptionUsage {
  usedMinutes: number;
  limitMinutes: number | null;
  enabled: boolean;
}

// ==================== CRM INTEGRATION ====================

export interface CrmConnectionView {
  provider: 'bitrix24' | 'amocrm';
  baseUrl: string;
  secretMasked: string;
  status: 'unverified' | 'ok' | 'error';
  lastCheckAt: string | null;
  lastError: string | null;
  userMap: Record<string, string>;
}

export interface CrmUpsertResult extends CrmConnectionView {
  test: { ok: boolean; accountName?: string; errorCode?: string };
}

export interface CrmUser {
  id: string;
  name: string;
  email: string | null;
  isAdmin?: boolean;
}

export interface CrmMyStatus {
  connected: boolean;
  provider?: 'bitrix24' | 'amocrm';
  mapped: boolean;
}

/** Подсказка о подключении CRM команде клиента. show=false — показывать нечего. */
export interface CrmHint {
  show: boolean;
  daysWorking?: number;
  manualCalls?: number;
  helpRequested?: boolean;
}

export interface CrmCallListItem {
  id: string;
  startedAt: string;
  direction: 'in' | 'out';
  phone: string;
  durationSec: number;
  recordingState: 'ready' | 'processing' | 'external_pbx' | 'none';
  alreadyImported: boolean;
}

export interface StagedRecording {
  stagedRecordingId: string;
  fileName: string;
  sizeBytes: number;
  callId: string;
  provider: string;
  callDate: string;
  direction: 'in' | 'out';
  phone: string;
  durationSec: number;
}

// ==================== REVIEWER ANALYTICS ====================

export interface ReviewerStatsOverdueEntry {
  id: string;
  sprintId: string;
  managerName: string;
  hoursWaiting: number;
}

export interface ReviewerStats {
  streakWeeks?: number;
  bestStreakWeeks?: number;
  reviewerId: string;
  reviewerName: string;
  reviewsWritten: number;
  // В скольких разных днях недели РОП разбирал записи (цель 5 из 5, включая пятницу).
  reviewDays?: number;
  targetReviews: number;
  avgReviewChars: number;
  medianHoursToRespond: number;
  qualityPct: number;
  norms: ReviewNorms;
  normStatus: 'green' | 'yellow' | 'red' | 'no-norm';
  overdue: ReviewerStatsOverdueEntry[];
}

// ==================== SPRINT PROGRESS ====================

export type ProgressZone = 'below' | 'good' | 'great';

export interface SprintProgress {
  managerId: string;
  calls: {
    count: number;
    thresholdGood: number;
    thresholdGreat: number;
    zone: ProgressZone;
  } | null;
  chats: {
    count: number;
    thresholdGood: number;
    thresholdGreat: number;
    zone: ProgressZone;
  } | null;
  selfReviewCompleted: number;
  reviewedByRop: number;
  overallZone: ProgressZone;
  // Разгонная (стартовая) неделя: запуск не с понедельника, пороги урезаны, неделя «на разгон».
  isRampUp?: boolean;
  rampUpFactor?: number; // множитель порогов (0..1); 1 = полная неделя
}

export interface TeamMemberProgress {
  id: string;
  fullName: string;
  color: string | null;
  entriesCount: number;
  zone: ProgressZone;
  submittedAt: string | null;
}

export interface TeamProgress {
  teamMembers: TeamMemberProgress[];
  isRampUp?: boolean;
  rampUpFactor?: number;
}

// ==================== ANALYTICS TYPES ====================

export interface ErrorFrequencyTag {
  tagId: string;
  tagName: string;
  color: string;
  count: number;
  percentage: number;
}

export interface ErrorFrequencyData {
  period: string;
  totalEntries: number;
  totalReviewed: number;
  tags: ErrorFrequencyTag[];
}

export interface ErrorTrendSprint {
  sprintLabel: string;
  count: number;
}

export interface ErrorTrendData {
  tagName: string;
  sprints: ErrorTrendSprint[];
  trend: 'increasing' | 'decreasing' | 'stable';
}

export interface ManagerTopError {
  tagName: string;
  count: number;
}

export interface ManagerStat {
  managerId: string;
  fullName: string;
  color: string;
  totalEntries: number;
  reviewed: number;
  avgSelfReviewLength: number;
  // Дней недели, в которые менеджер реально работал: ритм вместо объёма.
  activeDays?: number;
  topErrors: ManagerTopError[];
  completionRate: number;
}

export interface ManagerStatsData {
  managers: ManagerStat[];
}

export interface ActivityDayStat {
  day: string;
  count: number;
  avgSelfReviewLength: number;
}

export interface ActivityHourStat {
  hour: number;
  count: number;
}

export interface ActivityPatternsData {
  totalEntries: number;
  daysOfWeek: ActivityDayStat[];
  hours: ActivityHourStat[];
}

// ==================== INVITES ====================

export interface Invite {
  id: string;
  code: string;
  email: string;
  fullName?: string | null;
  role: string;
  status: 'pending' | 'accepted' | 'expired';
  companyId: string;
  invitedById: string;
  expiresAt: string | null;
  createdAt: string;
  company?: { id: string; name: string };
  invitedBy?: { id: string; fullName: string };
}

// ==================== NOTIFICATIONS ====================

export type NotificationType =
  | 'entry_submitted'
  | 'entry_reviewed'
  | 'entry_needs_revision'
  | 'sprint_started'
  | 'sprint_deadline'
  | 'invite_accepted'
  | 'crm_error'
  | 'help_requested'
  | 'rop_bonus'
  | 'playbook_candidate'
  // Зеркало backend/src/notifications/entities/notification.entity.ts. Список уже отставал
  // от бэкенда на пять значений (launch, stt_error, crm_connected, три аттестации): тип
  // приходит с сервера строкой, поэтому tsc расхождения не видел, а иконка молча пропадала.
  | 'launch'
  | 'stt_error'
  | 'crm_connected'
  | 'attestation_assigned'
  | 'attestation_ready_to_review'
  | 'attestation_result'
  | 'access_not_used'
  | 'team_changed';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  relatedId: string | null;
  createdAt: string;
}


// ==================== REVIEW TEMPLATES ====================

export interface ReviewTemplate {
  id: string;
  companyId: string;
  name: string;
  content: string;
  version: number;
  isActive: boolean;
  createdBy: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTemplateHistory {
  id: string;
  templateId: string;
  previousContent: string;
  newContent: string;
  changedBy: string;
  changedByName: string;
  version: number;
  changedAt: string;
}

// ==================== МЕТОДИЧКА ====================

export type PlaybookCardStatus = 'candidate' | 'active' | 'dismissed';
export type PlaybookTrend = 'increasing' | 'stable' | 'decreasing';
// Чем кандидат обнаружен: по тегу РОПа, семантически (текст разбора похож на другие даже без
// тега — страховка от 28.07.2026) или руками (карточка вне детекции).
export type PlaybookDetectionSource = 'tag' | 'semantic' | 'manual';

export interface PlaybookExample {
  kind: 'bad' | 'good';
  quote: string;
  entryId?: string;
}

/** Разбор, на основании которого система подняла кандидата — доказательство для РОПа. */
export interface PlaybookEvidenceEntry {
  entryId: string;
  entryNumber: number;
  sprintId: string;
  managerName: string;
  entryDate: string;
  reviewSnippet: string;
}

export interface PlaybookCard {
  id: string;
  companyId: string;
  errorTagId: string | null;
  title: string;
  ruleText: string | null;
  // Черновик правила от ИИ (Release 2) — платформа сама пишет его из evidence-цитат этой же
  // компании. РОП может принять как есть или переписать при подтверждении. Пусто, если Ollama
  // была недоступна в момент детекции или карточка ещё ждёт фоновой генерации.
  draftRuleText: string | null;
  detectionSource: PlaybookDetectionSource;
  examples: PlaybookExample[];
  status: PlaybookCardStatus;
  occurrenceCount: number;
  trend: PlaybookTrend;
  evidence: PlaybookEvidenceEntry[];
  ownerId: string | null;
  ownerName: string | null;
  confirmedAt: string | null;
  dismissedAt: string | null;
  dismissedReason: string | null;
  reviewDueAt: string | null;
  isOverdue?: boolean;
  // Release 4: планировщик не видел новых случаев этой ошибки давно — подсказка, решение
  // (архивировать/оставить) остаётся за РОПом.
  autoResolvedHint: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookProgress {
  activeCount: number;
  target: number;
  candidatesWaiting: number;
}

// ==================== АТТЕСТАЦИЯ ====================

export type AttestationTestStatus = 'generating' | 'draft' | 'active' | 'closed';
export type AttestationQuestionType = 'knowledge' | 'situation' | 'practice';
export type AttestationAttemptStatus = 'assigned' | 'submitted' | 'ai_graded' | 'graded';

export interface AttestationTest {
  id: string;
  companyId: string;
  title: string;
  status: AttestationTestStatus;
  passingScorePercent: number;
  deadline: string | null;
  formVariant: 'A' | 'B';
  originalTestId: string | null;
  isQuiz: boolean;
  generationError: string | null;
  createdAt: string;
  closedAt: string | null;
}

export interface AttestationQuestion {
  id: string;
  type: AttestationQuestionType;
  questionText: string;
  sortOrder: number;
  isCritical?: boolean;
  weight?: number;
  referenceAnswer?: string;
  cardId?: string | null;
}

export interface AttestationAttempt {
  id: string;
  testId: string;
  userId: string;
  user?: { id: string; fullName: string };
  test?: AttestationTest;
  status: AttestationAttemptStatus;
  startedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  totalScorePercent: string | null;
  passed: boolean | null;
  failedCritical: boolean;
  createdAt: string;
}

export interface AttestationAnswer {
  questionId: string;
  answerText: string;
  aiSuggestedScore?: 0 | 1 | 2 | null;
  aiSuggestedReasoning?: string | null;
  reviewerScore?: 0 | 1 | 2 | null;
}
