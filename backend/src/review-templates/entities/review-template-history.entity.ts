import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

@Entity('review_template_history')
export class ReviewTemplateHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  templateId!: string;

  @Column({ type: 'text' })
  previousContent!: string;

  @Column({ type: 'text' })
  newContent!: string;

  @Column({ type: 'varchar' })
  changedBy!: string;

  @Column({ type: 'varchar', length: 150 })
  changedByName!: string;

  @Column({ type: 'int' })
  version!: number;

  @CreateDateColumn()
  changedAt!: Date;
}
