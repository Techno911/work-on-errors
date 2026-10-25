import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('user_gamification')
export class UserGamification {
  @PrimaryGeneratedColumn('uuid') id!: string;

  @Column({ type: 'uuid', unique: true }) userId!: string;
  @OneToOne(() => User) @JoinColumn() user!: User;

  @Column({ default: 0 }) totalXp!: number;
  @Column({ default: 0 }) currentStreak!: number;   // недели подряд
  @Column({ default: 0 }) bestStreak!: number;

  // Заморозки серии: копятся каждые 8 недель (до 2), тратятся на пропущенную неделю
  @Column({ type: 'int', name: 'streak_freezes', default: 0 })
  streakFreezes!: number;
  @Column({ type: 'varchar', length: 10, nullable: true }) lastStreakWeek!: string | null; // 'YYYY-MM-DD' (пн)

  // Счётчики для ачивок
  @Column({ default: 0 }) consecutiveNoErrorReviews!: number; // для SNIPER
  @Column({ default: 0 }) consecutiveFullSelfReviews!: number; // для WRITER
  @Column({ default: 0 }) consecutiveGreatWeeks!: number;      // для GREAT_3X

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
