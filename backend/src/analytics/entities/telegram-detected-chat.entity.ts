import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Групповой чат, куда добавили нашего бота (событие my_chat_member приходит всегда,
 * даже при включённом privacy-mode, потому что оно про самого бота). Трекер видит
 * обнаруженные чаты в платформе и привязывает нужный к компании одной кнопкой —
 * не нужно постить служебную команду в живой чат клиента.
 */
@Entity('telegram_detected_chats')
export class TelegramDetectedChat {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'chat_id' })
  chatId!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  title!: string | null;

  // Есть ли у бота права администратора (нужны, чтобы видеть сообщения для фиксации старта).
  @Column({ type: 'boolean', name: 'is_admin', default: false })
  isAdmin!: boolean;

  // Компания, к которой чат привязан. null = обнаружен, но ещё не привязан.
  @Column({ type: 'uuid', name: 'bound_company_id', nullable: true })
  boundCompanyId!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
