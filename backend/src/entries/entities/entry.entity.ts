import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, ManyToMany, JoinColumn, JoinTable, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, Index } from 'typeorm';
import { Sprint } from '../../sprints/entities/sprint.entity';
import { User } from '../../users/entities/user.entity';
import { EntryType } from '../enums/entry-type.enum';
import { EntryStatus } from '../enums/entry-status.enum';
import { ErrorTag } from '../../error-tags/entities/error-tag.entity';
import { EntryScreenshot } from './entry-screenshot.entity';

@Index(['sprintId', 'managerId'])
@Index(['companyId', 'status'])
// Один звонок CRM импортируется один раз (race-safe на уровне БД); удалённую запись можно подтянуть заново
@Index('uq_entries_company_crm_call', ['companyId', 'crmCallId'], {
  unique: true,
  where: '"crmCallId" IS NOT NULL AND "deletedAt" IS NULL',
})
@Entity('entries')
export class Entry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  sprintId!: string;

  @ManyToOne(() => Sprint, sprint => sprint.entries)
  @JoinColumn({ name: 'sprintId' })
  sprint!: Sprint;

  @Index()
  @Column({ type: 'uuid' })
  managerId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'managerId' })
  manager!: User;

  @Index()
  @Column({ type: 'uuid' })
  companyId!: string;

  @Column({ type: 'enum', enum: EntryType })
  type!: EntryType;

  @Column({ type: 'int' })
  entryNumber!: number;

  @Column({ type: 'date' })
  entryDate!: string;

  @Column({ type: 'varchar', nullable: true })
  source!: string | null;

  @Column({ type: 'varchar', nullable: true })
  sourceCustom!: string | null;

  @Column({ type: 'text', nullable: true })
  transcription!: string | null;

  // Импорт из CRM: ID звонка для дедупликации (частичный уникальный индекс по companyId+crmCallId)
  @Column({ type: 'varchar', length: 255, nullable: true })
  crmCallId!: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  crmProvider!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  crmCallMetadata!: { phone?: string; direction?: string; durationSec?: number; callStartedAt?: string } | null;

  @Column({ type: 'text', nullable: true })
  selfReviewCorrect!: string | null;

  @Column({ type: 'text', nullable: true })
  selfReviewImprove!: string | null;

  @Column({ type: 'text', nullable: true })
  selfReviewSuggestions!: string | null;

  @Column({ type: 'text', nullable: true })
  reviewText!: string | null;

  // Версия текста разбора: sha256 сырого UTF8 reviewText (зеркало миграции 8.7.0).
  // reviewedAt версией не является — правка готового разбора его не сдвигает.
  // Пишется в review() при первом разборе и при правке одной записью с текстом.
  @Column({ type: 'varchar', length: 64, nullable: true })
  reviewTextHash!: string | null;

  // Личная отметка менеджера о чтении разбора (событие review-reread-confirm):
  // версия, которую подтвердили, момент первого подтверждения и последнего
  // перечитывания. Пишется ТОЛЬКО атомарным UPDATE в confirmReview() — review()
  // эти поля из снимка не сохраняет (не затереть факт при гонке правки РОПа).
  @Column({ type: 'varchar', length: 64, nullable: true })
  reviewConfirmedHash!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewConfirmedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  reviewRereadAt!: Date | null;

  // Эмбеддинг reviewText (bge-m3, 1024 чисел) — семантическая детекция повторов методички
  // сравнивает разборы по смыслу, независимо от того, поставил ли РОП тег (решение владельца продукта
  // 28.07.2026: тег-детекция ненадёжна, если РОП тег пропустит — нужна страховка от РОПа).
  // Считается один раз при ревью, дальше только читается.
  @Column({ type: 'jsonb', nullable: true })
  reviewEmbedding!: number[] | null;

  @Index() // IDX1-5: reviewer-stats/weekly-report фильтруют по reviewerId, единственная колонка без индекса
  @Column({ type: 'uuid', nullable: true })
  reviewerId!: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'reviewerId' })
  reviewer!: User | null;

  // Момент, когда менеджер сдал запись руководителю. Именно отсюда начинается норматив
  // разбора: до 10.08.2026 его считали от createdAt, то есть от создания черновика, и
  // время, пока менеджер писал самоанализ, списывалось со счёта руководителя.
  @Column({ type: 'timestamp', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;

  @Index()
  @Column({ type: 'enum', enum: EntryStatus, default: EntryStatus.DRAFT })
  status!: EntryStatus;

  @ManyToMany(() => ErrorTag)
  @JoinTable({ name: 'entry_error_tags' })
  errorTags!: ErrorTag[];

  @OneToMany(() => EntryScreenshot, screenshot => screenshot.entry)
  screenshots!: EntryScreenshot[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn()
  deletedAt!: Date | null;
}
