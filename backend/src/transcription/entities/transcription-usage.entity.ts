import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// Биллинг минут распознавания. Строка пишется ДО создания задачи у провайдера
// (pre-charge закрывает гонку параллельных загрузок) и удаляется при ошибке провайдера.
// Расход компании за месяц = SUM(seconds) по createdAt >= начала месяца.
@Index(['companyId', 'createdAt'])
@Entity('transcription_usage')
export class TranscriptionUsage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @Column({ type: 'uuid', nullable: true })
  entryAudioId!: string | null;

  @Column({ type: 'int' })
  seconds!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
