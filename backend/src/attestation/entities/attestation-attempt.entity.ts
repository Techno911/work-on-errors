import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn,
} from 'typeorm';
import { AttestationTest } from './attestation-test.entity';
import { User } from '../../users/entities/user.entity';

// assigned → задача видна менеджеру, ещё не начал. submitted → сдал, ждёт оценки ИИ.
// ai_graded → ИИ предложил баллы по всем ответам, ждёт проверки РОПа. graded → РОП подтвердил
// (согласился или поправил) каждый балл, попытка закрыта — passed/failed видно по totalScorePercent.
export enum AttestationAttemptStatus {
  ASSIGNED = 'assigned',
  SUBMITTED = 'submitted',
  AI_GRADED = 'ai_graded',
  GRADED = 'graded',
}

@Index(['testId', 'userId'], { unique: true }) // одна попытка на пользователя в тесте
@Entity('attestation_attempts')
export class AttestationAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  testId!: string;

  @ManyToOne(() => AttestationTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'testId' })
  test!: AttestationTest;

  // Явный type: колонка когда-то уехала в БД как varchar (миграция v7.6.0, копипаста от
  // createdBy) — JOIN с users.id (uuid) падал на КАЖДОМ запросе. Чинит v7.7.3-миграция;
  // здесь type фиксирует намерение, чтобы копипаста не повторилась.
  @Index()
  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: AttestationAttemptStatus, default: AttestationAttemptStatus.ASSIGNED })
  status!: AttestationAttemptStatus;

  @Column({ type: 'timestamp', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  submittedAt!: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  gradedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  gradedBy!: string | null;

  // null пока не выставлен финальный балл РОПом (ai-предложение не считается результатом —
  // ни одна оценка не входит в историю без подтверждения человеком).
  @Column({ type: 'numeric', precision: 5, scale: 1, nullable: true })
  totalScorePercent!: string | null;

  @Column({ type: 'boolean', nullable: true })
  passed!: boolean | null;

  // Провален критичный вопрос — отдельный флаг, даже если общий процент выше порога
  // (план: критичная ошибка не должна теряться в среднем балле).
  @Column({ type: 'boolean', default: false })
  failedCritical!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
