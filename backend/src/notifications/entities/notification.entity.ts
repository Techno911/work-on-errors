import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum NotificationType {
  ENTRY_SUBMITTED = 'entry_submitted',
  ENTRY_REVIEWED = 'entry_reviewed',
  ENTRY_NEEDS_REVISION = 'entry_needs_revision',
  SPRINT_STARTED = 'sprint_started',
  SPRINT_DEADLINE = 'sprint_deadline',
  INVITE_ACCEPTED = 'invite_accepted',
  CRM_ERROR = 'crm_error',
  HELP_REQUESTED = 'help_requested',
  // Дисциплина премии РОПа: владелец в мастере попросил обсудить (трекеру+суперадмину) или
  // трекер согласовал условия напрямую и подключил премию (суперадмину). PG-enum: миграция
  // v6.2.0-notification-rop-bonus-enum.sql (synchronize=false не добавляет значения сам).
  ROP_BONUS = 'rop_bonus',
  // Фаза запуска: тишина после kick-off / петля прокрутилась (трекеру и суперадмину).
  // PG-enum: миграция v6.4.0-launch.sql (synchronize=false не добавляет значения сам).
  LAUNCH = 'launch',
  // Отказ сервиса распознавания речи (трекеру и суперадмину). Заведён после инцидента
  // 25.07.2026: Сбер ответил 402 семь раз подряд, это ушло только в лог контейнера, и
  // о том, что команда клиента не может работать, мы узнали от самого клиента через двое суток.
  // PG-enum: миграция v7.0.0-notification-stt-error-enum.sql.
  STT_ERROR = 'stt_error',
  // Администратор CRM клиента подключил портал по ссылке-поручению (трекеру и суперадмину):
  // подключение происходит без нашего участия, и без сигнала мы бы не узнали, что оно случилось.
  // PG-enum: миграция v7.2.0-crm-setup-link.sql.
  CRM_CONNECTED = 'crm_connected',
  // Система сама заметила повтор ошибки и подняла кандидата в методичку (РОПу и владельцу):
  // решение подтвердить/отклонить не должно зависеть от того, увидел ли РОП галочку в форме
  // разбора — уведомление гарантирует, что о находке узнают, даже если разбор давно закрыт.
  // PG-enum: миграция v7.4.0-playbook-cards.sql.
  PLAYBOOK_CANDIDATE = 'playbook_candidate',
  // Аттестация по методичке (Release 3 плана «Методичка», 28.07.2026): менеджеру — назначена
  // задача; РОПу — сотрудник сдал и ждут проверки ответов. PG-enum: миграция
  // v7.6.0-attestation.sql.
  ATTESTATION_ASSIGNED = 'attestation_assigned',
  ATTESTATION_READY_TO_REVIEW = 'attestation_ready_to_review',
  ATTESTATION_RESULT = 'attestation_result',
  // Доступ выдан, а вход не состоялся (РОПу, владельцу, нам). Заведён после разбора клиента
  // 05.08.2026: двух менеджеров завели 30.07, пароли ушли владельцу в переписку, никто не
  // вошёл, и об этом не узнал НИКТО, потому что выдача доступа не порождала события вовсе.
  // PG-enum: миграция v7.8.0-lifecycle-signals.sql.
  ACCESS_NOT_USED = 'access_not_used',
  // Состав команды клиента изменился: сотрудника завели или убрали (владельцу, РОПу, нам).
  // У этого события нет исполнителя, который мог бы «починить», есть только тот, кто должен
  // знать: собственник узнаёт о составе своей команды от нас, а не случайным заходом.
  // PG-enum: миграция v7.8.0-lifecycle-signals.sql.
  TEAM_CHANGED = 'team_changed',
}

@Index(['userId', 'isRead']) // IDX1-5: bell/mark-all-read фильтруют именно так на каждый запрос
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'enum', enum: NotificationType })
  type!: NotificationType;

  @Column()
  title!: string;

  @Column({ type: 'text' })
  message!: string;

  @Column({ type: 'varchar', nullable: true })
  linkUrl!: string | null;

  @Column({ default: false })
  isRead!: boolean;

  @Column({ type: 'varchar', nullable: true })
  relatedId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
