import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export const DEFAULT_ERROR_TAG_COLOR = '#B45309';

@Entity('error_tags')
export class ErrorTag {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @Column()
  name!: string;

  @Column({ nullable: true })
  description!: string;

  @Column({ type: 'varchar', default: DEFAULT_ERROR_TAG_COLOR })
  color!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
