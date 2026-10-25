import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from 'typeorm';
import type { RopBonusTier } from '../../companies/entities/company.entity';

/**
 * Снимок закрытого месяца премии РОПа. Финансовая история неизменна:
 * записывается один раз в день расчёта (payoutDay) и не пересчитывается
 * при изменении норматива или уровней.
 */
@Entity('rop_bonus_snapshots')
@Unique(['companyId', 'period'])
export class RopBonusSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Column({ type: 'varchar', length: 7 })
  period!: string; // YYYY-MM

  @Column({ type: 'int', name: 'on_time_count' })
  onTimeCount!: number;

  @Column({ type: 'int', name: 'late_count' })
  lateCount!: number;

  // Сколько из «не в зачёте» — короткие ревью (меньше minReviewChars), отдельно от опоздавших
  @Column({ type: 'int', name: 'short_count', default: 0 })
  shortCount!: number;

  @Column({ type: 'int', name: 'on_time_pct', nullable: true })
  onTimePct!: number | null;

  @Column({ type: 'int', name: 'max_hours_to_respond' })
  maxHoursToRespond!: number;

  // Норматив качества на момент фиксации — чтобы пересчёт не брал текущую настройку
  @Column({ type: 'int', name: 'min_review_chars', default: 150 })
  minReviewChars!: number;

  // Учёт рабочих дней на момент фиксации
  @Column({ type: 'boolean', name: 'workdays_only', default: true })
  workdaysOnly!: boolean;

  // Имя РОПа на момент фиксации — состав команды мог смениться
  @Column({ type: 'varchar', length: 255, name: 'rop_name', nullable: true })
  ropName!: string | null;

  @Column({ type: 'jsonb' })
  tiers!: RopBonusTier[];

  @Column({ type: 'int' })
  amount!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
