import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('review_templates')
export class ReviewTemplate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text' })
  content!: string;

  @Column({ type: 'int', default: 1 })
  version!: number;

  @Column({ default: true })
  isActive!: boolean;

  /** userId, кто создал или последний редактировал */
  @Column({ type: 'varchar' })
  createdBy!: string;

  /** Имя для отображения в UI без JOIN */
  @Column({ type: 'varchar', length: 150, nullable: true })
  createdByName!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
