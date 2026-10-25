import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import type { XpSettingsData, AchievementSettingsData } from '../../gamification/types/gamification-settings.types';

// Жизненный статус компании (операционный бейдж трекера). Порядок = условный «прогресс».
export type CompanyStatus = 'launch' | 'active' | 'paused' | 'closed' | 'demo';

// Подписи статусов для серверных текстов (журнал событий, сигналы). Фронт держит свою карту
// с цветами; здесь только слова, которые уходят в сообщения человеку.
export const COMPANY_STATUS_LABEL: Record<CompanyStatus, string> = {
  launch: 'Запуск',
  active: 'Активна',
  paused: 'На паузе',
  closed: 'Закрыта',
  demo: 'Демо',
};

// Режим лицензии: trial — бесплатный тест N дней от старта работы; implementation — команда уже во
// внедрении (контракт идёт), лицензия бесплатна пока идёт внедрение, счётчик триала не показываем.
export type LicenseMode = 'trial' | 'implementation';

export interface ReviewNormsData {
  minReviewsPerWeek: number;
  maxHoursToRespond: number;
  minReviewCharsAvg: number;
  qualityThresholdPct: number;
}

// Единый дефолт нормативов ревью (раньше жил копиями в 9 местах и дрейфовал).
// Срок разбора 24 часа — решение владельца продукта: скорость обратной связи
// напрямую влияет на качество развития команды. Прод-миграция: v6.5.0-review-sla-24h.sql.
export const DEFAULT_REVIEW_NORMS: ReviewNormsData = {
  minReviewsPerWeek: 0,
  maxHoursToRespond: 24,
  minReviewCharsAvg: 150,
  qualityThresholdPct: 80,
};

/**
 * Пауза как состояние, а не ярлык (волна 2 разбора жизненного цикла, 05.08.2026).
 *
 * До этого «На паузе» означал ровно одно: компания исчезала из ежедневного свода здоровья.
 * То есть пауза выключала нам зрение, а не работу, и вернуть к компании внимание было нечему:
 * ни причины, ни срока, ни ответственного, ни признака провала. клиента так простоял 112 дней.
 * Теперь у паузы есть обязательные поля и дата возврата, по которой сторож сам поднимает её.
 */
export interface PauseInfoData {
  reason?: string;            // причина одной строкой
  startedAt?: string;         // ISO: когда началась
  expectedReturnAt?: string;  // ISO-дата планируемого возврата (по ней возвращается внимание)
  responsible?: string;       // ответственный со стороны клиента
  conditionToEnd?: string;    // что должно случиться, чтобы пауза кончилась
  lastReminderAt?: string;    // ISO: когда сторож последний раз напоминал (анти-спам)
}

/**
 * Приостановка работы за неоплату (решение владельца продукта).
 *
 * Намеренно ОТДЕЛЬНАЯ сущность от status: 'paused'. Операционная пауза это состояние клиента
 * (ищут менеджеров, отпуск, сезон): у неё есть срок, дата возврата и предел 60 дней, она
 * приглушает сигналы и НИКОМУ не закрывает вход. Приостановка за неоплату это наше решение:
 * срока у неё нет (длится, пока не оплатят), снимается только кнопкой владельца ЧиП, и она
 * закрывает работу всей команде клиента. Свести их в один флаг значит получить состояние,
 * которое одновременно обязано кончиться по дате и не обязано.
 */
export interface PaymentHoldData {
  startedAt?: string;   // ISO: когда приостановили
  note?: string;        // что показать собственнику (номер счёта, период задолженности)
  byUserId?: string;    // кто приостановил (наш сотрудник)
  byLabel?: string;     // имя для журнала
  liftedAt?: string;    // ISO: когда сняли в последний раз (история, не признак состояния)
}

export interface ReportChannelsData {
  weeklyAccountability?: {
    emails?: string[];
    telegramChatIds?: string[];
    // Владелец подтвердил, что отчёт идёт по верному адресу. Каналы проставляет трекер, но
    // отчётность собственная: он должен увидеть адрес и сказать «верно», а не обнаружить
    // через месяц, что сводка уходила не туда. Живёт в jsonb — миграция схемы не нужна.
    confirmedByOwnerAt?: string;
  };
}

export interface RopBonusTier {
  thresholdPct: number;
  amount: number;
}

export interface RopBonusData {
  enabled: boolean;
  tiers: RopBonusTier[];
  // Линейная модель по договору (Приложение № 3): премия = baseAmount × (% ревью в срок),
  // если % >= minThresholdPct, иначе 0. Если baseAmount задан — линейный режим (приоритет над tiers).
  // Так платформа считает премию как подписано в договоре, а не ступенями.
  baseAmount?: number | null;      // базовая сумма (по договору ≥ 20000 ₽)
  minThresholdPct?: number | null; // отсечка (дефолт 60): ниже — премия за месяц 0
  // День месяца (1–28), когда расчёт премии за прошлый месяц уходит в каналы отчётности.
  // null/отсутствие = расчёт по дате не отправляется.
  payoutDay?: number | null;
  // Срок «в срок» считается по рабочим дням: дедлайн с выходных переносится на понедельник 12:00.
  // По умолчанию включено (отсутствие поля = true).
  workdaysOnly?: boolean;
  // Владелец осознанно отказался от премии как контура дисциплины РОПа.
  // Без явного выбора (enabled или declinedExplicitly) петля считается незащищённой.
  declinedExplicitly?: boolean;
}

// Настройка премии в линейной модели (что предлагаем собственнику и что он подтверждает).
export interface RopBonusSetup {
  baseAmount: number;
  minThresholdPct: number;
  payoutDay: number | null;
  workdaysOnly: boolean;
}

// Предложение премии РОПа собственнику (флоу-аналог оферты): трекер готовит рекомендацию из
// договора/профиля → ссылка-лендинг → собственник под своим логином принимает / правит / отклоняет.
// Отдельно от боевого ropBonus, чтобы не двигать снапшоты и cron выплат. Токен НЕ гасится после
// ответа (нужен для экрана «решение уже принято»); занятость гейтится respondedAt.
export interface RopBonusProposalData {
  token?: string | null;
  status?: 'draft' | 'sent' | 'accepted' | 'pending_review' | 'declined';
  draft?: RopBonusSetup;
  ownerVariant?: RopBonusSetup | null; // вариант собственника «настроить иначе» (в прод не пишется)
  source?: 'contract' | 'profile';     // честная атрибуция на лендинге
  sentAt?: string | null;
  respondedAt?: string | null;         // единственный флаг «уже отвечено» (идемпотентность)
  // 'discuss' — владелец в мастере захотел обсудить премию с трекером (не принял/не отклонил).
  // 'agreed' — трекер согласовал условия напрямую в переписке и подключил премию (item 5).
  decision?: 'recommended' | 'customized' | 'declined' | 'discuss' | 'agreed' | null;
}

export interface TranscriptionSettingsData {
  enabled: boolean;
  // Лимит минут распознавания в календарный месяц. null = без лимита.
  monthlyMinutesLimit: number | null;
}

// Реквизиты юрлица/ИП заказчика (из договора) + метаданные загруженного файла договора.
// Заказчик в оферте — юрлицо/ИП, а не бренд: legalName подставляется в оферту вместо name.
// Плейсхолдеры полной оферты от экспертной команды берутся из этих полей.
export interface LegalInfoData {
  legalName?: string;   // ООО «Ромашка» / ИП Иванов Иван Иванович
  inn?: string;
  kpp?: string;         // у ИП нет
  ogrn?: string;        // ОГРН / ОГРНИП
  address?: string;     // юридический адрес
  signatory?: string;   // «в лице … действующего на основании …»
  contractFileName?: string;    // оригинальное имя загруженного договора
  contractStoredName?: string;  // имя файла на диске (uploads/contracts)
  contractUploadedAt?: string;  // ISO-дата загрузки
}

// TG5: telegramWorkChatId раньше без unique — один чат мог оказаться привязан сразу к двум
// компаниям (повторная привязка чужого/старого кода), и активность/рассылки начали бы путаться
// между компаниями. Partial-индекс: NULL (не привязан) допускается у скольких угодно компаний.
@Index('uq_companies_telegram_work_chat', ['telegramWorkChatId'], {
  unique: true,
  where: '"telegram_work_chat_id" IS NOT NULL',
})
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'varchar', length: 500, name: 'logo_url', nullable: true })
  logoUrl!: string | null;

  @Column({ type: 'int', name: 'calls_per_week', default: 5 })
  callsPerWeek!: number;

  @Column({ type: 'int', name: 'chats_per_week', default: 5 })
  chatsPerWeek!: number;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'manager_deadline_day',
    // Решение владельца продукта: менеджеры сдают до пятницы (было — среда). У РОПа
    // дня-дедлайна по смыслу нет: он разбирает каждую запись в течение 24 часов.
    default: 'friday',
  })
  managerDeadlineDay!: string;

  // НЕ ИСПОЛЬЗУЕТСЯ с v6.8.0: у РОПа норматив 24 часа на запись, день-дедлайн конкурировал
  // с ним и разрешал копить записи до конца недели. Колонку оставили (данные не удаляем),
  // из UI и расчётов убрали.
  @Column({
    type: 'varchar',
    length: 20,
    name: 'reviewer_deadline_day',
    default: 'friday',
  })
  reviewerDeadlineDay!: string;

  @Column({ type: 'int', name: 'threshold_good_calls', default: 5 })
  thresholdGoodCalls!: number;

  @Column({ type: 'int', name: 'threshold_good_chats', default: 5 })
  thresholdGoodChats!: number;

  @Column({ type: 'int', name: 'threshold_great_calls', default: 8 })
  thresholdGreatCalls!: number;

  @Column({ type: 'int', name: 'threshold_great_chats', default: 8 })
  thresholdGreatChats!: number;

  @Column({ type: 'boolean', default: true })
  callsEnabled!: boolean;

  @Column({ type: 'boolean', default: true })
  chatsEnabled!: boolean;

  @Column({ type: 'int', default: 50 })
  minSelfReviewCorrectChars!: number;

  @Column({ type: 'int', default: 80 })
  minSelfReviewImproveChars!: number;

  @Column({ type: 'int', default: 0 })
  minSelfReviewSuggestionsChars!: number;

  @Column({ type: 'int', default: 150 })
  minReviewChars!: number;

  @Column({ default: false })
  onboardingCompleted!: boolean;

  @Column({
    type: 'jsonb',
    name: 'call_sources',
    default: () => `'["Fireflies.ai", "OTR.AI", "Вручную"]'`,
  })
  callSources!: string[];

  @Column({
    type: 'jsonb',
    name: 'chat_sources',
    default: () => `'["Instagram", "Telegram", "WhatsApp", "VK", "Другое"]'`,
  })
  chatSources!: string[];

  @Column({
    type: 'jsonb',
    name: 'xp_settings',
    // Синхронизировано с DEFAULT_XP_SETTINGS (gamification-settings.types.ts) — раньше DB-default
    // был заморожен на старых цифрах (reviewNoErrors:15 живой, хотя код считает его отключённым — GAM12).
    default: () => `'{"entrySubmitted":3,"selfReviewComplete":10,"reviewReceived":2,"reviewNoErrors":0,"weeklyGoodZone":30,"weeklyGreatZone":60,"streakBonus":25}'`,
  })
  xpSettings!: XpSettingsData;

  @Column({
    type: 'jsonb',
    name: 'achievement_settings',
    default: () => `'{"sniperThreshold":3,"writerThreshold":5,"great3xThreshold":3,"streak7Threshold":7,"streak30Threshold":30}'`,
  })
  achievementSettings!: AchievementSettingsData;

  @Column({ type: 'boolean', name: 'gamification_enabled', default: true })
  gamificationEnabled!: boolean;

  @Column({ type: 'boolean', name: 'reviewer_can_edit_gamification', default: false })
  reviewerCanEditGamification!: boolean;

  // Разрешает РОПу (reviewer) видеть и редактировать шаблоны ревью. По умолчанию выключено —
  // собственник включает осознанно, когда РОП готов. См. план «Работа над ошибками 2.8.x».
  @Column({ type: 'boolean', name: 'reviewer_can_edit_review_templates', default: false })
  reviewerCanEditReviewTemplates!: boolean;

  // Нормативы РОПа по блоку «Работа над ошибками». Значения могут быть переопределены
  // по итогам диагностики. Ноль означает "норматив не задан" — алерты/статус не считаются.
  @Column({
    type: 'jsonb',
    name: 'review_norms',
    default: () => `'${JSON.stringify(DEFAULT_REVIEW_NORMS)}'`,
  })
  reviewNorms!: ReviewNormsData;

  // Премия РОПа за работу над ошибками: % ревью команды в срок за календарный месяц → сумма по тиру.
  // Тиры по убыванию thresholdPct, ниже минимального тира премия 0. Выключено по умолчанию (gated-by-default).
  @Column({
    type: 'jsonb',
    name: 'rop_bonus',
    default: () => `'{"enabled":false,"tiers":[{"thresholdPct":95,"amount":20000},{"thresholdPct":80,"amount":16000}]}'`,
  })
  ropBonus!: RopBonusData;

  // Предложение премии РОПа собственнику (см. RopBonusProposalData). Пустой объект = предложение
  // ещё не готовилось. Отдельно от боевого ropBonus.
  @Column({ type: 'jsonb', name: 'rop_bonus_proposal', default: () => `'{}'::jsonb` })
  ropBonusProposal!: RopBonusProposalData;

  // Автотранскрипция звонков (SaluteSpeech). Включено по умолчанию с лимитом минут:
  // без транскриптов стоимость одного ревью для РОПа запредельна, и петля рвётся
  // на его звене (аудит 3.0). Лимит защищает расход минут; owner видит расход read-only.
  @Column({
    type: 'jsonb',
    name: 'transcription',
    default: () => `'{"enabled":true,"monthlyMinutesLimit":300}'`,
  })
  transcription!: TranscriptionSettingsData;

  // Каналы доставки weekly-accountability отчёта и overdue-алертов. Пустые массивы = канал отключён.
  @Column({
    type: 'jsonb',
    name: 'report_channels',
    default: () => `'{"weeklyAccountability":{"emails":[],"telegramChatIds":[]}}'`,
  })
  reportChannels!: ReportChannelsData;

  @OneToMany(() => User, (user) => user.company)
  users!: User[];

  // IANA-таймзона клиента (Камчатка UTC+12 … Калининград UTC+2): по ней считаются
  // граница недели спринтов, перенос дедлайнов с выходных и утренние отчёты.
  @Column({ type: 'varchar', length: 64, default: 'Europe/Moscow' })
  timezone!: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  // Жизненный статус компании для трекера (операционный бейдж, не путать с isActive петли):
  // launch — идёт запуск/онбординг; active — работаем; paused — на паузе (напр. ищут менеджеров);
  // closed — работа завершена (архив, не удаляем); demo — демо-пространство, не боевой клиент.
  @Column({ type: 'varchar', length: 16, default: 'launch' })
  status!: CompanyStatus;

  // Состояние паузы (см. PauseInfoData). Пустой объект = компания не на паузе. Живёт отдельно
  // от status: статус это намерение человека, а поля паузы это её условия и срок.
  @Column({ type: 'jsonb', name: 'pause_info', default: () => `'{}'::jsonb` })
  pauseInfo!: PauseInfoData;

  // Приостановка работы за неоплату (см. PaymentHoldData). true = команда клиента видит экран
  // приостановки вместо платформы, а сервер отвечает отказом на её запросы. Наши роли
  // (суперадмин, трекер) работают как обычно: приостановка адресована клиенту, не нам.
  @Column({ type: 'boolean', name: 'payment_hold', default: false })
  paymentHold!: boolean;

  @Column({ type: 'jsonb', name: 'payment_hold_info', default: () => `'{}'::jsonb` })
  paymentHoldInfo!: PaymentHoldData;

  // Режим лицензии (см. LicenseMode). При 'implementation' триал не считается и не показывается.
  @Column({ type: 'varchar', length: 16, name: 'license_mode', default: 'trial' })
  licenseMode!: LicenseMode;

  // Онбординг-оферта: одноразовый токен для ссылки, по которой владелец принимает
  // оферту (= договор + согласие на обработку ПДн команды + старт триала).
  // offerToken обнуляется после принятия. offerAcceptedAt/trialEndsAt = null → оферта ещё не принята.
  @Column({ type: 'varchar', length: 64, name: 'offer_token', nullable: true, unique: true })
  offerToken!: string | null;

  @Column({ type: 'timestamp', name: 'offer_accepted_at', nullable: true })
  offerAcceptedAt!: Date | null;

  // Согласие на ПДн — самостоятельный акт (свой чекбокс на странице оферты), с 01.09.2025
  // такое согласие обязано фиксироваться отдельно от акцепта прочих условий (ст. 9 ч. 1 152-ФЗ).
  @Column({ type: 'timestamp', name: 'pdn_consent_accepted_at', nullable: true })
  pdnConsentAcceptedAt!: Date | null;

  // Доказательная база факта акцепта (для спора): IP на момент клика.
  @Column({ type: 'varchar', length: 64, name: 'offer_accepted_ip', nullable: true })
  offerAcceptedIp!: string | null;

  // trialEndsAt считается от РЕАЛЬНОЙ даты старта работы (workStartedAt), а не от принятия
  // оферты: маркетолога иногда ещё нанимают, и старт плавающий. До старта работы = null.
  @Column({ type: 'timestamp', name: 'trial_ends_at', nullable: true })
  trialEndsAt!: Date | null;

  // Дата фактического старта работы: первая активность в привязанном рабочем ТГ-чате
  // (Bot API не видит историю до добавления бота) либо проставленная трекером вручную.
  @Column({ type: 'timestamp', name: 'work_started_at', nullable: true })
  workStartedAt!: Date | null;

  // Привязанный рабочий чат Telegram (chat_id). Бот-админ в нём фиксирует старт работы.
  @Column({ type: 'varchar', length: 64, name: 'telegram_work_chat_id', nullable: true })
  telegramWorkChatId!: string | null;

  // Фаза «Запуск»: момент, когда трекер после онбординга отправил команде kick-off в рабочий
  // чат. От него считает сторож тишины (launch.scheduler) и авто-переход launch → active.
  @Column({ type: 'timestamp', name: 'launched_at', nullable: true })
  launchedAt!: Date | null;

  // Одноразовый код для привязки чата: трекер постит «/bind <code>» в рабочем чате.
  @Column({ type: 'varchar', length: 32, name: 'telegram_bind_code', nullable: true, unique: true })
  telegramBindCode!: string | null;

  // Длительность бесплатного тест-периода в днях (от workStartedAt). По умолчанию месяц.
  @Column({ type: 'int', name: 'trial_days', default: 30 })
  trialDays!: number;

  // Реквизиты юрлица/ИП заказчика + метаданные файла договора (см. LegalInfoData).
  @Column({ type: 'jsonb', name: 'legal_info', default: () => `'{}'` })
  legalInfo!: LegalInfoData;

  // Владелец на онбординге нажал «позвать трекера» (не разобрался с подключением CRM).
  // Трекер видит флаг в карточке компании + получает уведомление; сбрасывается, когда трекер помог.
  @Column({ type: 'timestamp', name: 'crm_help_requested_at', nullable: true })
  crmHelpRequestedAt!: Date | null;

  // Ссылка-поручение на подключение CRM: администратор портала клиента открывает её БЕЗ входа
  // в платформу и вставляет вебхук у себя. Нужна потому, что доступ к порталу CRM есть только
  // у клиента: трекер физически не может создать вебхук сам, а пересылка инструкции в переписке
  // теряется. Токен одноразовый (гаснет при успешном подключении) и с ограниченным сроком.
  @Column({ type: 'varchar', length: 64, name: 'crm_setup_token', nullable: true, unique: true })
  crmSetupToken!: string | null;

  @Column({ type: 'timestamp', name: 'crm_setup_token_expires_at', nullable: true })
  crmSetupTokenExpiresAt!: Date | null;

  // «Подключать нечем»: у клиента нет CRM, телефония не отдаёт записи, звонки идут с личных
  // телефонов. Ставит наш трекер или владелец ЧиП, и только тогда платформа перестаёт
  // предлагать подключение. Без такой отметки подсказка приходит: молчание платформы и
  // осознанное решение нашей команды выглядят одинаково, а это разные вещи.
  @Column({ type: 'boolean', name: 'crm_not_applicable', default: false })
  crmNotApplicable!: boolean;

  @Column({ type: 'jsonb', name: 'crm_not_applicable_info', default: () => `'{}'` })
  crmNotApplicableInfo!: { reason?: string; markedBy?: string; markedAt?: string };

  // Руководитель отдела продаж отложил подсказку. Напоминание раз в неделю, а не при каждом
  // входе: ежедневное превращается в шум, который перестают замечать.
  @Column({ type: 'timestamp', name: 'crm_hint_snoozed_until', nullable: true })
  crmHintSnoozedUntil!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
