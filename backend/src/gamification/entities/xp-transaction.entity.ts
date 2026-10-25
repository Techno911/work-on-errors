import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { XpReason } from '../enums/xp-reason.enum';

// IDX1-5: недельный XP/история (getProfile, getLeaderboard, awardWeeklyZoneOnce) фильтрует
// именно по userId+createdAt на каждый запрос профиля/лидерборда.
@Index(['userId', 'createdAt'])
@Entity('xp_transactions')
export class XpTransaction {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ type: 'uuid' }) userId!: string;
  @Column({ type: 'int' }) amount!: number;
  @Column({ type: 'varchar' }) reason!: XpReason;
  @Column({ type: 'uuid', nullable: true }) entryId!: string | null;
  @CreateDateColumn() createdAt!: Date;
}
