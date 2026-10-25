import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index,
} from 'typeorm';

// Черновик: вопросы ещё генерируются фоном (LLM на CPU — не быстро, нельзя держать HTTP-запрос).
// Активна: назначена, менеджеры проходят. Закрыта: РОП подвёл итог, дальше только история.
export enum AttestationTestStatus {
  GENERATING = 'generating',
  DRAFT = 'draft',
  ACTIVE = 'active',
  CLOSED = 'closed',
}

@Index(['companyId', 'status'])
@Entity('attestation_tests')
export class AttestationTest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid' })
  companyId!: string;

  @Column({ type: 'varchar', length: 255 })
  title!: string;

  @Column({ type: 'enum', enum: AttestationTestStatus, default: AttestationTestStatus.GENERATING })
  status!: AttestationTestStatus;

  // Из стандарта обучения отдела продаж 1.0 дословно: порог 75%. Аттестация по методичке —
  // про свои же уже разобранные ошибки, поэтому строже дефолта разрешаем компании поднять его.
  @Column({ type: 'int', default: 75 })
  passingScorePercent!: number;

  @Column({ type: 'date', nullable: true })
  deadline!: string | null;

  // 'A' — основная форма, 'B' — вторая форма для пересдачи (план: «пересдача не может идти
  // по той же версии теста, иначе это проверка памяти на конкретные вопросы»).
  @Column({ type: 'varchar', length: 1, default: 'A' })
  formVariant!: 'A' | 'B';

  // Тест-пересдача ссылается на исходный — история решений видна цепочкой, не отдельными строками.
  @Column({ type: 'uuid', nullable: true })
  originalTestId!: string | null;

  @Column()
  createdBy!: string;

  // Release 4 (живой цикл): короткий еженедельный квиз по 1-2 карточкам, а не полная
  // аттестация. Создаётся и назначается планировщиком сам, без ручной кнопки РОПа — план:
  // «навык растёт от частоты», а не от разовых больших проверок.
  @Column({ type: 'boolean', default: false })
  isQuiz!: boolean;

  @Column({ type: 'text', nullable: true })
  generationError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  closedAt!: Date | null;
}
