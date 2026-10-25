import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Entry } from './entry.entity';

@Entity('entry_screenshots')
export class EntryScreenshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  entryId!: string;

  @ManyToOne(() => Entry, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entryId' })
  entry!: Entry;

  @Column()
  fileUrl!: string;

  @Column()
  fileName!: string;

  @Column({ type: 'int' })
  fileSize!: number;

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'text', nullable: true, default: null })
  extractedText!: string | null; // Текст, распознанный OCR из скриншота

  // AUDIT-0710 (M2): сбой OCR раньше не отличался от «текста нет» — молчал.
  @Column({ type: 'boolean', name: 'ocr_failed', default: false })
  ocrFailed!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
