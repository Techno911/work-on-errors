import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
  CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';
import { ErrorTag } from '../../error-tags/entities/error-tag.entity';

export enum PlaybookCardStatus {
  // Система заметила повтор, доказательства собраны, ждёт решения РОПа — в документ ещё не входит.
  CANDIDATE = 'candidate',
  // РОП подтвердил: карточка часть методички, видна команде.
  ACTIVE = 'active',
  // РОП решил, что это не системная ошибка (совпадение) или правило больше не актуально.
  DISMISSED = 'dismissed',
}

export type PlaybookTrend = 'increasing' | 'stable' | 'decreasing';

// Чем кандидат обнаружен: по тегу РОПа (как раньше), семантически (текст разбора похож на
// другие, даже без тега — страховка на случай, если РОП тег не поставил) или руками (карточка
// вне детекции, для ситуаций, не сводящихся к одному тегу).
export type PlaybookDetectionSource = 'tag' | 'semantic' | 'manual';

export interface PlaybookExample {
  kind: 'bad' | 'good';
  quote: string;
  entryId?: string;
}

/** Разбор, на основании которого система подняла кандидата — то самое доказательство. */
export interface PlaybookEvidenceEntry {
  entryId: string;
  entryNumber: number;
  sprintId: string;
  managerName: string;
  entryDate: string;
  reviewSnippet: string;
}

@Index(['companyId', 'status'])
// Одна открытая (кандидат/активная) карточка на тег в компании — повтор не плодит дубли.
// Ручные карточки (errorTagId = null) под ограничение не попадают.
@Index('uq_playbook_cards_company_tag', ['companyId', 'errorTagId'], {
  unique: true,
  where: '"errorTagId" IS NOT NULL',
})
@Entity('playbook_cards')
export class PlaybookCard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  companyId!: string;

  @Column({ type: 'uuid', nullable: true })
  errorTagId!: string | null;

  @ManyToOne(() => ErrorTag, { nullable: true })
  @JoinColumn({ name: 'errorTagId' })
  errorTag!: ErrorTag | null;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  ruleText!: string | null;

  // Черновик правила от ИИ (Release 2) — генерируется из evidence-цитат самим сервером,
  // ничего не примысливает из интернета. РОП видит его в карточке кандидата и либо принимает
  // как есть при подтверждении (тогда копируется в ruleText), либо пишет своё поверх.
  @Column({ type: 'text', nullable: true })
  draftRuleText!: string | null;

  @Column({ type: 'varchar', length: 20, default: 'tag' })
  detectionSource!: PlaybookDetectionSource;

  // Id разборов, из которых родился СЕМАНТИЧЕСКИЙ кластер — нужно, чтобы повторный прогон
  // детекции не поднимал второго кандидата на тот же самый кластер разборов.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  sourceEntryIds!: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  examples!: PlaybookExample[];

  @Column({ type: 'enum', enum: PlaybookCardStatus, default: PlaybookCardStatus.CANDIDATE })
  status!: PlaybookCardStatus;

  // Снимок на момент последнего пересчёта (обновляется при каждом новом разборе с этим тегом,
  // пока карточка не отклонена насовсем) — не требует отдельной плановой задачи.
  @Column({ type: 'int', default: 0 })
  occurrenceCount!: number;

  @Column({ type: 'varchar', length: 20, default: 'stable' })
  trend!: PlaybookTrend;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  evidence!: PlaybookEvidenceEntry[];

  @Column({ type: 'uuid', nullable: true })
  ownerId!: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  ownerName!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  confirmedBy!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  dismissedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  dismissedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  dismissedReason!: string | null;

  // occurrenceCount на момент отклонения — повторный кандидат поднимается только когда
  // после отклонения тег отметили ещё несколько раз, иначе РОП видит то же решение снова.
  @Column({ type: 'int', nullable: true })
  occurrenceCountAtDismissal!: number | null;

  // Следующий плановый пересмотр (квартал от подтверждения). Просроченная карточка помечается
  // непроверенной и не должна попадать в аттестацию, пока РОП её не подтвердит заново.
  @Column({ type: 'date', nullable: true })
  reviewDueAt!: string | null;

  @Column({ type: 'int', default: 1 })
  version!: number;

  // Release 4 плана «Методичка» (живой цикл): дата последнего засчитанного повтора этой
  // ошибки. Обновляется ТОЛЬКО когда карточка реально освежается новым инцидентом — не
  // трогается при ручной правке текста, поэтому по ней честно видно, давно ли ошибка
  // повторялась в последний раз.
  @Column({ type: 'timestamp', nullable: true })
  lastOccurrenceAt!: Date | null;

  // Планировщик пометил: тренд давно падает и новых случаев нет — похоже, команда перестала
  // так ошибаться. РОП решает сам (архивировать/оставить), платформа только подсказывает.
  @Column({ type: 'boolean', default: false })
  autoResolvedHint!: boolean;

  // Чтобы не слать одно и то же напоминание о просрочке каждый день.
  @Column({ type: 'timestamp', nullable: true })
  overdueNotifiedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
