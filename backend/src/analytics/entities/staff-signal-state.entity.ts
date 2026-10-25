import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Открытая проблема, о которой мы УЖЕ сообщили нашей стороне.
 *
 * Существует ради одного правила: человек получает сообщение о новости, а не о состоянии.
 * Свод здоровья считает картину заново каждый день, и без этой таблицы одна и та же строка
 * («клиента: 18 рабочих дней без записей») уходила бы владельцу каждое утро, пока проблема жива.
 * Здесь помнится, что именно было сказано, когда и на какой ступени, поэтому повторно
 * поднимается только изменившееся, закрывшееся или застоявшееся дольше срока напоминания.
 */
@Entity('staff_signals')
export class StaffSignalState {
  /** Сторож: loop-health, channel-check, watchdog-liveness. */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  /** Устойчивый идентификатор проблемы внутри сторожа: quiet:<companyId>, hold:<companyId>. */
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'signal_id' })
  signalId!: string;

  /**
   * Ступень проблемы. Смена ступени это новость при том же идентификаторе: тишина перешла
   * из первой рабочей недели во вторую, очередь из «копится» в «просрочку». Волатильные
   * числа (18 дней, 19 дней) в ступень не кладём, иначе каждый день считался бы новостью.
   */
  @Column({ type: 'varchar', length: 64, default: '' })
  stage!: string;

  /** Последний текст строки: он же уходит в напоминание и показывается в админке. */
  @Column({ type: 'text' })
  text!: string;

  @Column({ type: 'timestamp', name: 'first_seen_at' })
  firstSeenAt!: Date;

  @Column({ type: 'timestamp', name: 'last_sent_at' })
  lastSentAt!: Date;
}
