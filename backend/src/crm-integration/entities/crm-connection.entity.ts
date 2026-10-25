import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

export type CrmProviderKey = 'bitrix24' | 'amocrm';
export type CrmConnectionStatus = 'unverified' | 'ok' | 'error';

/**
 * Подключение CRM компании. Секрет (токен вебхука Б24 / долгосрочный токен amo)
 * хранится зашифрованным AES-256-GCM — наружу уходит только маска.
 * Отдельная таблица, НЕ JSONB в Company: companySettings целиком сериализуется
 * на фронт, токен в нём утёк бы в браузер.
 */
@Entity('crm_connections')
export class CrmConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Одна компания — одно подключение (MVP не поддерживает две CRM сразу)
  @Index({ unique: true })
  @Column({ type: 'uuid', name: 'company_id' })
  companyId!: string;

  @Column({ type: 'varchar', length: 20 })
  provider!: CrmProviderKey;

  // Б24: https://portal.bitrix24.ru/rest/{user_id} (часть вебхука до секрета)
  // amo: https://subdomain.amocrm.ru
  @Column({ type: 'varchar', length: 500, name: 'base_url' })
  baseUrl!: string;

  @Column({ type: 'text', name: 'secret_encrypted' })
  secretEncrypted!: string;

  // Маппинг наших менеджеров на пользователей CRM: { [platformUserId]: crmUserId }.
  // Свойство подключения, не пользователя: смена CRM сбрасывает карту атомарно.
  @Column({ type: 'jsonb', name: 'user_map', default: () => `'{}'` })
  userMap!: Record<string, string>;

  @Column({ type: 'varchar', length: 20, default: 'unverified' })
  status!: CrmConnectionStatus;

  @Column({ type: 'timestamp', name: 'last_check_at', nullable: true })
  lastCheckAt!: Date | null;

  // Код CrmErrorCode последней ошибки — для баннера владельцу
  @Column({ type: 'varchar', length: 100, name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
