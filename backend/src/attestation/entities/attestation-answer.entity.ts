import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn,
} from 'typeorm';
import { AttestationAttempt } from './attestation-attempt.entity';
import { AttestationQuestion } from './attestation-question.entity';

@Index(['attemptId', 'questionId'], { unique: true })
@Entity('attestation_answers')
export class AttestationAnswer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  attemptId!: string;

  @ManyToOne(() => AttestationAttempt, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attemptId' })
  attempt!: AttestationAttempt;

  @Column()
  questionId!: string;

  @ManyToOne(() => AttestationQuestion, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'questionId' })
  question!: AttestationQuestion;

  @Column({ type: 'text', default: '' })
  answerText!: string;

  // Предложение платформы (мировая практика: оценка ВСЕГДА показывает, на основании чего она
  // поставлена — см. п.2.1 плана) — не финальный балл, пока РОП не подтвердил.
  @Column({ type: 'int', nullable: true })
  aiSuggestedScore!: 0 | 1 | 2 | null;

  @Column({ type: 'text', nullable: true })
  aiSuggestedReasoning!: string | null;

  // Финальный балл. Пока null — попытка не может считаться graded.
  @Column({ type: 'int', nullable: true })
  reviewerScore!: 0 | 1 | 2 | null;

  @CreateDateColumn()
  createdAt!: Date;
}
