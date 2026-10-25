import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index, CreateDateColumn,
} from 'typeorm';
import { AttestationTest } from './attestation-test.entity';
import { PlaybookCard } from '../../playbook/entities/playbook-card.entity';

// Три слоя, как в плане (мировая практика сильнее вопросов на голое знание): знание правила,
// применение в описанной ситуации, развёрнутая рабочая проба на стыке деталей.
export type AttestationQuestionType = 'knowledge' | 'situation' | 'practice';

@Index(['testId'])
@Entity('attestation_questions')
export class AttestationQuestion {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  testId!: string;

  @ManyToOne(() => AttestationTest, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'testId' })
  test!: AttestationTest;

  // Карточка методички, из которой вопрос порождён — по ней потом разбор результата
  // показывает «какое правило это закрывает» (пункт 11 списка работ РОПа из плана).
  @Column({ type: 'uuid', nullable: true })
  cardId!: string | null;

  @ManyToOne(() => PlaybookCard, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'cardId' })
  card!: PlaybookCard | null;

  @Column({ type: 'varchar', length: 20 })
  type!: AttestationQuestionType;

  // Критичный вопрос: провал = незачёт целиком, даже при высоком общем проценте (план: «одна
  // мелочь не должна валить человека так же, как грубая ошибка» — и наоборот, грубая ошибка
  // не должна теряться в среднем балле).
  @Column({ type: 'boolean', default: false })
  isCritical!: boolean;

  // Вклад вопроса в итоговый процент — веса нормализуются суммой по тесту, не хардкод в процентах.
  @Column({ type: 'int', default: 1 })
  weight!: number;

  @Column({ type: 'text' })
  questionText!: string;

  // Эталон для РОПа при проверке — берётся из правила карточки, не отдельной генерацией:
  // эталон обязан быть тем же текстом, что утверждён в методичке, а не домыслом модели.
  @Column({ type: 'text' })
  referenceAnswer!: string;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
