import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, OneToMany, JoinColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { Company } from '../../companies/entities/company.entity';
import { SprintStatus } from '../enums/sprint-status.enum';
import { Entry } from '../../entries/entities/entry.entity';

@Index(['companyId', 'status']) // IDX1-5: getOrCreateCurrent/checkCompanyDebt и т.п. фильтруют так на каждый цикл
// DI5: без этого констрейнта два одновременных запроса (два человека открыли доску в один
// момент) оба не находили активный спринт на неделю и оба создавали свой — на неделю
// оказывалось два спринта. Один спринт на неделю компании — навсегда, не только «активный».
@Index('uq_sprints_company_start', ['companyId', 'startDate'], { unique: true })
@Entity('sprints')
export class Sprint {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  companyId!: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'companyId' })
  company!: Company;

  @Column({ type: 'date' })
  startDate!: string;

  @Column({ type: 'date' })
  endDate!: string;

  @Column({ type: 'varchar', length: 50 })
  label!: string;

  @Column({ type: 'enum', enum: SprintStatus, default: SprintStatus.ACTIVE })
  status!: SprintStatus;

  @OneToMany(() => Entry, entry => entry.sprint)
  entries!: Entry[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
