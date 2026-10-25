import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { localParts } from '../common/company-time.util';
import { escapeTelegramHtml as esc } from './telegram.service';
import { StaffNotifierService } from './staff-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';

/**
 * Сторож паузы: возврат внимания по дате.
 *
 * Пауза без механизма возврата это не пауза, а исчезновение: у клиента она длилась 112 дней и
 * закончилась случайным обнаружением. Здесь дата возврата, названная при постановке, сама
 * становится сигналом, а просрочка эскалируется. Пауза приглушает то, что мы шлём команде
 * клиента, и ничего не приглушает из того, что мы шлём себе.
 */
@Injectable()
export class PauseWatchScheduler {
  private readonly logger = new Logger(PauseWatchScheduler.name);

  /** Не чаще одного напоминания в эти сутки на компанию. */
  private static readonly REMIND_EVERY_DAYS = 3;
  /** Предельный суммарный срок паузы по регламенту блока. */
  private static readonly MAX_PAUSE_DAYS = 60;

  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
    private readonly events: CompanyEventsService,
    private readonly notifier: StaffNotifierService,
  ) {}

  // Ежечасно: разбираем компанию в 11:00 её локального времени, по будням.
  @Cron('50 * * * *', { name: 'pause-watch' })
  async watch(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { status: 'paused' } });
    for (const company of companies) {
      const lp = localParts(company.timezone);
      if (lp.hour !== 11 || lp.isoWeekday > 5) continue;
      try {
        await this.checkCompany(company);
      } catch (err) {
        this.logger.error(`pause-watch ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  /** Возвращает true, если по компании поднят сигнал (для ручного прогона и тестов). */
  async checkCompany(company: Company, force = false): Promise<boolean> {
    const info = company.pauseInfo ?? {};
    const now = Date.now();

    // Анти-спам: напоминаем не чаще раза в трое суток.
    if (!force && info.lastReminderAt) {
      const since = (now - new Date(info.lastReminderAt).getTime()) / 86_400_000;
      if (since < PauseWatchScheduler.REMIND_EVERY_DAYS) return false;
    }

    // Легаси-пауза без условий: поставлена до того, как у паузы появились поля. Молчать о ней
    // нельзя — это ровно то состояние, в котором клиент и пропадает.
    if (!info.expectedReturnAt) {
      await this.raise(
        company,
        'Пауза без условий',
        `Компания «${company.name}» стоит на паузе, но у паузы нет ни причины, ни даты возврата, ни ответственного. ` +
          `Оформите паузу заново в карточке компании либо перезапустите работу.`,
      );
      await this.stampReminder(company);
      return true;
    }

    const returnAt = new Date(info.expectedReturnAt);
    const startedAt = info.startedAt ? new Date(info.startedAt) : null;
    const daysPaused = startedAt ? Math.floor((now - startedAt.getTime()) / 86_400_000) : 0;
    const daysOverdue = Math.floor((now - returnAt.getTime()) / 86_400_000);

    if (daysPaused > PauseWatchScheduler.MAX_PAUSE_DAYS) {
      await this.raise(
        company,
        'Пауза превысила предельный срок',
        `Компания «${company.name}» на паузе ${daysPaused} дней при пределе ${PauseWatchScheduler.MAX_PAUSE_DAYS}. ` +
          `По регламенту блок считается прерванным по инициативе клиента: сроки программы и контрольный замер гарантии ` +
          `пересчитываются письменно. Причина паузы: ${info.reason ?? 'не указана'}.`,
      );
      await this.stampReminder(company);
      return true;
    }

    if (daysOverdue >= 0) {
      const responsible = info.responsible ? ` Ответственный со стороны клиента: ${info.responsible}.` : '';
      const condition = info.conditionToEnd ? ` Условие возврата: ${info.conditionToEnd}.` : '';
      await this.raise(
        company,
        daysOverdue === 0 ? 'Сегодня дата возврата из паузы' : 'Пауза просрочена',
        `Компания «${company.name}»: пауза с ${startedAt ? startedAt.toLocaleDateString('ru-RU') : 'неизвестной даты'} ` +
          `должна была кончиться ${returnAt.toLocaleDateString('ru-RU')}` +
          (daysOverdue > 0 ? `, прошло уже ${daysOverdue} дн.` : '.') +
          ` Причина: ${info.reason ?? 'не указана'}.${responsible}${condition} ` +
          `Дальше по регламенту перезапуск: проверить входы, подтвердить состав, отправить сообщение о возобновлении.`,
      );
      await this.stampReminder(company);
      return true;
    }
    return false;
  }

  /** Сигнал только нашей стороне: пауза это наше обязательство вернуться, а не задача клиента. */
  private async raise(company: Company, title: string, message: string): Promise<void> {
    const staff = await this.userRepo.find({
      where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
    });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.LAUNCH,
        title: `${company.name}: ${title.toLowerCase()}`,
        message,
        linkUrl: `/admin/company/${company.id}`,
        relatedId: company.id,
      });
    }
    // Через StaffNotifierService, как и все остальные сообщения нашей стороне: повод здесь
    // событийный (срок возврата наступил), повтор гасит собственная отметка stampReminder.
    const sent = await this.notifier.alert('pause-watch', `⏸ <b>${esc(title)}</b>\n${esc(message)}`);
    await this.events.logDelivery(company.id, 'telegram_staff', sent, title);
    this.logger.log(`[pause-watch] ${company.name}: ${title}`);
  }

  private async stampReminder(company: Company): Promise<void> {
    company.pauseInfo = { ...(company.pauseInfo ?? {}), lastReminderAt: new Date().toISOString() };
    await this.companyRepo.save(company);
    await this.events.log({
      companyId: company.id,
      type: CompanyEventType.PAUSED,
      title: 'Напоминание о паузе',
      details: 'Сторож паузы поднял компанию: срок возврата наступил или пауза не оформлена.',
    });
  }
}
