import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CompanyEvent, CompanyEventType } from './entities/company-event.entity';
import { describeNormChanges, type NormChange } from '../companies/norm-diff';

export interface LogEventInput {
  companyId: string;
  type: CompanyEventType;
  title: string;
  details?: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Журнал событий компании: одна таблица, куда пишется всё, что случилось с клиентом,
 * включая попытки доставки сигналов и их отказы.
 *
 * Запись в журнал НИКОГДА не должна ронять саму операцию: человека завели, сообщение
 * отправили, статус сменили — а журнал это описание факта, а не сам факт. Поэтому log()
 * fail-open и не бросает наружу (тот же принцип, что у хуков в глобальном конфиге).
 */
@Injectable()
export class CompanyEventsService {
  private readonly logger = new Logger(CompanyEventsService.name);

  constructor(
    @InjectRepository(CompanyEvent) private readonly repo: Repository<CompanyEvent>,
  ) {}

  async log(input: LogEventInput): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          companyId: input.companyId,
          type: input.type,
          title: input.title,
          details: input.details ?? null,
          actorUserId: input.actorUserId ?? null,
          actorLabel: input.actorLabel ?? null,
          payload: input.payload ?? {},
        }),
      );
    } catch (err) {
      this.logger.warn(`событие не записано (${input.type}): ${(err as Error).message}`);
    }
  }

  /**
   * Попытка доставки сигнала клиенту: и успех, и отказ. Именно отказ важнее — он
   * неотличим от тишины, пока не записан («мёртвый канал», см. память signal-channel-silently-dead).
   */
  async logDelivery(
    companyId: string,
    channel: 'telegram_work_chat' | 'telegram_owner' | 'telegram_staff' | 'email_owner',
    ok: boolean,
    subject: string,
    details?: string,
    /** Машинный вид сигнала («overdue», «debt»): по нему считается пауза между письмами. */
    kind?: string,
  ): Promise<void> {
    await this.log({
      companyId,
      type: ok ? CompanyEventType.SIGNAL_SENT : CompanyEventType.SIGNAL_FAILED,
      title: ok ? `Сигнал доставлен: ${subject}` : `Сигнал не доставлен: ${subject}`,
      details: details ?? null,
      payload: kind ? { channel, ok, kind } : { channel, ok },
    });
  }

  /**
   * Смена планки команды. Пишется из ОБОИХ мест, где нормативы могут поменяться: карточка
   * трекера (режим целиком) и настройки владельца (поштучно). Формат один на оба входа,
   * иначе журнал через месяц читался бы как два разных журнала.
   *
   * Пустой список изменений событие не создаёт: владелец сохраняет настройки целиком, и
   * запись «нормативы изменены» на каждое нажатие «Сохранить» обесценила бы весь журнал.
   */
  async logNormsChange(input: {
    companyId: string;
    changes: NormChange[];
    /** Имя применённого режима, если планку двигали пресетом, а не полем. */
    presetLabel?: string;
    actorUserId?: string | null;
    actorLabel?: string | null;
  }): Promise<void> {
    if (input.changes.length === 0) return;
    const title = input.presetLabel
      ? `Нормативы команды: режим «${input.presetLabel}»`
      : `Нормативы команды изменены вручную (${input.changes.length})`;
    await this.log({
      companyId: input.companyId,
      type: CompanyEventType.NORMS_CHANGED,
      title,
      details: describeNormChanges(input.changes),
      actorUserId: input.actorUserId ?? null,
      actorLabel: input.actorLabel ?? null,
      payload: {
        ...(input.presetLabel ? { preset: input.presetLabel } : {}),
        changes: input.changes.map(c => ({ key: c.key, from: c.from, to: c.to })),
      },
    });
  }

  /** Лента компании для карточки трекера (свежие сверху). */
  async list(companyId: string, limit = 100): Promise<CompanyEvent[]> {
    return this.repo.find({
      where: { companyId },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 300),
    });
  }

  /** Последнее событие данного типа: «когда мы последний раз проверяли каналы». */
  async lastOfType(companyId: string, type: CompanyEventType): Promise<CompanyEvent | null> {
    return this.repo.findOne({ where: { companyId, type }, order: { createdAt: 'DESC' } });
  }

  /**
   * Когда этот вид сигнала последний раз УХОДИЛ данным каналом. Нужно, чтобы ежедневный
   * сторож не превращался в ежедневное письмо: сигнал, который приходит каждый день,
   * перестают читать так же быстро, как молчащий (см. правило про замок, который не гаснет).
   */
  async lastDeliveryAt(
    companyId: string,
    kind: string,
    channel: 'telegram_owner' | 'email_owner',
  ): Promise<Date | null> {
    const row = await this.repo
      .createQueryBuilder('e')
      .where('e.company_id = :companyId', { companyId })
      .andWhere('e.type = :type', { type: CompanyEventType.SIGNAL_SENT })
      .andWhere("e.payload ->> 'kind' = :kind", { kind })
      .andWhere("e.payload ->> 'channel' = :channel", { channel })
      .orderBy('e.created_at', 'DESC')
      .getOne();
    return row?.createdAt ?? null;
  }
}
