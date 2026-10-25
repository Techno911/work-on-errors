import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';
import { AchievementType } from '../enums/achievement-type.enum';

@Entity('achievements')
export class Achievement {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'varchar' }) type!: AchievementType;
  @CreateDateColumn() earnedAt!: Date;
}
