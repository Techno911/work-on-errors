import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Карта @username → chat_id, выученная из апдейтов бота.
 * Telegram Bot API не умеет слать по @username — только по chat_id, и только тем,
 * кто хотя бы раз написал боту /start. Поэтому при первом резолве юзернейма
 * читаем getUpdates и запоминаем всех, кто писал боту.
 */
@Entity('telegram_contacts')
export class TelegramContact {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  username!: string; // в нижнем регистре, без @

  @Column({ type: 'varchar', length: 32, name: 'chat_id' })
  chatId!: string;

  // Пользователь платформы, привязавший этот чат через deep-link /start <одноразовый токен>.
  // null у контактов, выученных пассивно из getUpdates без payload.
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
