import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { Entry } from './entry.entity';

// Статусная машина: converting → queued → transcribing → done | failed.
// queued — ждём свободный слот провайдера (лимит параллельных задач SaluteSpeech).
export type EntryAudioStatus = 'converting' | 'queued' | 'transcribing' | 'done' | 'failed';

@Entity('entry_audio')
export class EntryAudio {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Фактически 1:1 — повторная загрузка заменяет предыдущую запись.
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  entryId!: string;

  @ManyToOne(() => Entry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entryId' })
  entry!: Entry;

  // Уже сконвертированный моно-MP3: /uploads/audio/{file}.mp3
  @Column({ type: 'varchar' })
  fileUrl!: string;

  @Column({ type: 'varchar' })
  originalFileName!: string;

  @Column({ type: 'int', default: 0 })
  fileSize!: number;

  @Column({ type: 'int', default: 0 })
  durationSec!: number;

  @Index()
  @Column({ type: 'varchar', default: 'converting' })
  status!: EntryAudioStatus;

  // Русский текст ошибки для UI (показывается менеджеру как есть).
  @Column({ type: 'text', nullable: true })
  errorMessage!: string | null;

  @Column({ type: 'varchar', default: 'salutespeech' })
  provider!: string;

  @Column({ type: 'varchar', nullable: true })
  providerTaskId!: string | null;

  // Готовый диалог «Голос 1: … / Голос 2: …».
  @Column({ type: 'text', nullable: true })
  transcriptionResult!: string | null;

  // Когда результат записан в Entry.transcription (null = ручной текст не перетирали).
  @Column({ type: 'timestamp', nullable: true })
  appliedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  // Heartbeat пайплайна: recovery-cron возобновляет задачи с протухшим updatedAt.
  @UpdateDateColumn()
  updatedAt!: Date;
}
