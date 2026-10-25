import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * Что произошло с компанией. Список закрытый: журнал должен читаться человеком через год,
 * а не превращаться в свалку произвольных строк.
 *
 * Заведён 05.08.2026 по разбору жизненного цикла клиента (волна 2): без журнала ни одно сообщение
 * платформы не может честно сказать «на паузе с 6 июня», а любой следующий разбор снова
 * пришлось бы собирать по переписке.
 */
export enum CompanyEventType {
  COMPANY_CREATED = 'company_created',
  STATUS_CHANGED = 'status_changed',
  OFFER_ACCEPTED = 'offer_accepted',
  LAUNCHED = 'launched',
  RELAUNCHED = 'relaunched',
  PAUSED = 'paused',
  RESUMED = 'resumed',
  // Приостановка за неоплату и её снятие. Отдельно от паузы: у паузы причина на стороне
  // клиента и есть дата возврата, здесь причина в расчётах и возврат зависит от оплаты.
  PAYMENT_HOLD_ON = 'payment_hold_on',
  PAYMENT_HOLD_OFF = 'payment_hold_off',
  MEMBER_ADDED = 'member_added',
  MEMBER_REMOVED = 'member_removed',
  ACCESS_SENT = 'access_sent',
  ACCESS_ACTIVATED = 'access_activated',
  FIRST_LOGIN = 'first_login',
  FIRST_ENTRY = 'first_entry',
  FIRST_REVIEW = 'first_review',
  // Попытка доставки сигнала и её исход. Именно этих двух строк не хватало, чтобы ответить
  // на вопрос «а сигнал вообще уходил»: раньше отправка не оставляла следа нигде.
  SIGNAL_SENT = 'signal_sent',
  SIGNAL_FAILED = 'signal_failed',
  CHANNEL_CHECK = 'channel_check',
  // Наша команда решила, что подключать CRM у этого клиента нечем (или вернула подсказку).
  // Колонка type это varchar, миграция для нового значения не нужна.
  CRM_NOT_APPLICABLE = 'crm_not_applicable',
  // Планка команды: сколько разборов в неделю и какой длины тексты. Заведено 24.08.2026,
  // когда клиент спросил, почему у менеджеров стало 8 разборов вместо 5, и ответить было
  // нечем: нормативы меняются из двух мест, а следа не оставляло ни одно.
  NORMS_CHANGED = 'norms_changed',
  // Режим лицензии: бесплатный тест или уже внедрение. Тот же вопрос «кто переключил».
  LICENSE_MODE_CHANGED = 'license_mode_changed',
}

@Index(['companyId', 'createdAt'])
@Entity('company_events')
export class CompanyEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Column({ type: 'varchar', length: 32 })
  type!: CompanyEventType;

  /** Одна строка для человека: «Работа перезапущена», «Доступ не дошёл до владельца». */
  @Column({ type: 'varchar', length: 255 })
  title!: string;

  /** Подробности той же строкой прозы: причина паузы, имя человека, текст отказа Telegram. */
  @Column({ type: 'text', nullable: true })
  details!: string | null;

  /** Кто сделал (наш сотрудник или человек клиента). null = система. */
  @Column({ type: 'uuid', name: 'actor_user_id', nullable: true })
  actorUserId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'actor_label', nullable: true })
  actorLabel!: string | null;

  /** Машиночитаемая часть: id сущности, канал доставки, старое и новое значение статуса. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  payload!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
