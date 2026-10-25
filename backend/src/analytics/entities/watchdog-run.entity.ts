import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * Отметка о прогоне сторожа.
 *
 * Заменяет ежедневное «всё хорошо» в Telegram. Раньше живость крона доказывалась тем, что
 * свод приходил даже когда сказать было нечего: молчащий сторож неотличим от упавшего.
 * Цена такого доказательства — сообщение без ценности каждый день, и владелец справедливо
 * его отменил (директива 03.09.2026). Теперь живость доказывает эта отметка: её видно в
 * админке в любой момент, а тревога уходит только когда сторож ЗАМОЛЧАЛ, то есть когда
 * сообщение действительно требует действия.
 */
@Entity('watchdog_runs')
export class WatchdogRun {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  key!: string;

  @Column({ type: 'timestamp', name: 'last_run_at' })
  lastRunAt!: Date;

  /** Когда этот сторож в последний раз реально что-то сказал человеку. */
  @Column({ type: 'timestamp', name: 'last_sent_at', nullable: true })
  lastSentAt!: Date | null;

  /** Сколько строк было в последнем прогоне: 0 значит «посчитал и промолчал». */
  @Column({ type: 'int', name: 'last_signal_count', default: 0 })
  lastSignalCount!: number;
}
