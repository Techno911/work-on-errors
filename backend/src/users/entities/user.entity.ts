import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { UserRole } from '../enums/user-role.enum';
import { Company } from '../../companies/entities/company.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Exclude()
  @Column({ type: 'varchar', length: 255 })
  password!: string;

  @Column({ type: 'varchar', length: 255, name: 'full_name' })
  fullName!: string;

  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.MANAGER,
  })
  role!: UserRole;

  @Index()
  @Column({ type: 'uuid', name: 'company_id', nullable: true })
  companyId!: string | null;

  @ManyToOne(() => Company, (company) => company.users, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'company_id' })
  company!: Company | null;

  @Column({ type: 'varchar', length: 7, nullable: true })
  color!: string | null;

  @Column({ type: 'varchar', length: 500, name: 'avatar_url', nullable: true })
  avatarUrl!: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'timestamp', name: 'onboarding_seen_at', nullable: true })
  onboardingSeenAt!: Date | null;

  // Последняя версия платформы, анонс которой человек уже прочитал («Что нового»).
  // Фронт сравнивает её с реестром анонсов и показывает всё, что вышло позже. null = не видел
  // ничего; таким при миграции проставлена версия ПЕРЕД первым анонсом, иначе действующая
  // команда получила бы на руки всю историю релизов разом.
  @Column({ type: 'varchar', length: 16, name: 'releases_seen_version', nullable: true })
  releasesSeenVersion!: string | null;

  // Личное скрытие учебной карточки «Первые шаги» на главной: момент, когда человек сам
  // убрал подсказку. null = не скрывал. Пишется только про себя через POST /users/me/
  // first-steps-hidden; в UpdateUserDto сознательно не заведено, иначе чужую отметку можно
  // было бы сбросить через PATCH /users/:id (образец — releasesSeenVersion выше).
  // Сбрасывается в null при фактической смене role/companyId (users.service.update):
  // выбор одного контекста не переносится в другой.
  @Column({ type: 'timestamptz', name: 'first_steps_hidden_at', nullable: true })
  firstStepsHiddenAt!: Date | null;

  // Последний вход по паролю (НЕ «Глазами»: impersonation не отмечает). null = ни разу не входил;
  // питает бейдж «ещё не входил» и правило запуска «новый пароль только не входившим».
  // Прод-миграция v6.5.0 + backfill из refresh_tokens.
  @Column({ type: 'timestamp', name: 'last_login_at', nullable: true })
  lastLoginAt!: Date | null;

  // Одноразовый TTL-токен для Telegram deep-link (t.me/<бот>?start=<token>). Раньше payload
  // deep-link'а был самим userId (детерминированный, не секрет — GET /users отдаёт UUID любому
  // в компании) — атакующий мог собрать чужую ссылку и привязать СВОЙ Telegram к ЧУЖОМУ userId,
  // перехватывая личные дайджесты жертвы (TG2). Токен случайный, гасится после первого /start.
  // Именная одноразовая ссылка первого входа (волна 3 разбора жизненного цикла): платформа
  // больше не рассылает пароли в чат. Человек переходит по своей ссылке, задаёт пароль сам,
  // ссылка гаснет. Токен случайный и с коротким сроком жизни — ссылка, живущая в переписке
  // вечно, это тот же пароль, только длиннее.
  @Exclude()
  @Column({ type: 'varchar', length: 64, name: 'activation_token', nullable: true })
  activationToken!: string | null;

  @Exclude()
  @Column({ type: 'timestamp', name: 'activation_token_expires_at', nullable: true })
  activationTokenExpiresAt!: Date | null;

  @Exclude()
  @Column({ type: 'varchar', length: 32, name: 'telegram_link_token', nullable: true })
  telegramLinkToken!: string | null;

  @Exclude()
  @Column({ type: 'timestamp', name: 'telegram_link_token_expires_at', nullable: true })
  telegramLinkTokenExpiresAt!: Date | null;

  // Личное согласие сотрудника на обработку ПДн (ст. 88 ТК РФ) — отдельно от того, что владелец
  // поручает обработку платформе в оферте (ст. 6 152-ФЗ). Работодатель не может дать это согласие
  // за работника — экран на первом входе, гейтит reviewer/manager до входа в рабочий интерфейс.
  @Column({ type: 'timestamp', name: 'pdn_consent_accepted_at', nullable: true })
  pdnConsentAcceptedAt!: Date | null;

  // Ознакомление с Положением о ПДн работодателя (ст. 86 ч. 8 ТК РФ) — САМОСТОЯТЕЛЬНАЯ
  // обязанность, отдельная от согласия на передачу третьему лицу выше.
  @Column({ type: 'timestamp', name: 'lna_acknowledged_at', nullable: true })
  lnaAcknowledgedAt!: Date | null;

  @Exclude()
  @Column({ type: 'varchar', length: 64, name: 'pdn_consent_ip', nullable: true })
  pdnConsentIp!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt!: Date | null;
}
