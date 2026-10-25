import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThanOrEqual, Not, Repository } from 'typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TelegramService, escapeTelegramHtml as esc } from './telegram.service';
import { StaffNotifierService } from './staff-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';

/**
 * Сторож фазы «Запуск»: нулевой оборот петли — самое хрупкое место (продолжение вывода
 * аудита «петля рвётся на РОПе»: здесь она рвётся ещё раньше, до первой записи).
 * Отсчёт от launchedAt (kick-off трекера в рабочий чат):
 *  - 48 часов ни одной записи → сигнал трекеру/суперадмину в колокольчик + РОПу в Telegram;
 *  - 120 часов (5 дней) тишины → мягкое напоминание команде в рабочий чат + колокольчик;
 *  - первый разбор РОПа → компания сама переходит «Запуск» → «Активна», трекеру сигнал.
 * Часовые окна (hoursSince === N при ежечасном cron) гарантируют одно срабатывание без
 * дополнительных флагов в БД — тот же паттерн, что в loop-guard.
 */
@Injectable()
export class LaunchScheduler {
  private readonly logger = new Logger(LaunchScheduler.name);

  constructor(
    @InjectRepository(Entry) private readonly entryRepo: Repository<Entry>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
    private readonly events: CompanyEventsService,
    private readonly notifier: StaffNotifierService,
  ) {}

  @Cron('20 * * * *', { name: 'launch-watchdog' })
  async watch(): Promise<void> {
    const companies = await this.companyRepo.find({
      where: { status: 'launch', launchedAt: Not(IsNull()) },
    });
    for (const company of companies) {
      try {
        await this.checkCompany(company);
      } catch (err) {
        this.logger.error(`launch-watchdog ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  private async checkCompany(company: Company): Promise<void> {
    // ВСЁ считается от момента запуска, а не за всю историю компании (правка 09.08.2026).
    // Раньше оба счётчика были «за всё время», и на перезапускаемой компании сторож слеп
    // мгновенно: старые записи есть почти всегда, поэтому сигналы 48 и 120 часов не могли
    // сработать никогда, а первый же СТАРЫЙ разбор объявлял «петля прокрутилась» и снимал
    // компанию с наблюдения. Именно в эту дыру провалился клиента после перезапуска 06.08.
    const since = new Date(company.launchedAt as Date);
    const reviewed = await this.entryRepo.count({
      where: {
        companyId: company.id,
        status: EntryStatus.REVIEWED,
        reviewedAt: MoreThanOrEqual(since),
      },
    });
    if (reviewed > 0) {
      const from = company.status;
      company.status = 'active';
      await this.companyRepo.save(company);
      // Журнал компании обязан знать про АВТОМАТИЧЕСКИЕ переходы тоже: до 09.08.2026 этот
      // переход не писался никуда, и историю жизненного цикла нельзя было восстановить —
      // в журнале клиента статус менялся «сам собой», без строки о том, кто это сделал.
      await this.events.log({
        companyId: company.id,
        type: CompanyEventType.STATUS_CHANGED,
        title: 'Статус: «Запуск» → «Активна»',
        details: 'Первый разбор РОПа после запуска: петля прокрутилась, сторож запуска снят.',
        actorLabel: 'Сторож запуска',
        payload: { from, to: 'active', reason: 'first_review_after_launch' },
      });
      await this.notifyStaff(
        company,
        'Запуск завершён',
        `Компания «${company.name}»: первый разбор РОПа прошёл, петля прокрутилась. Статус переведён в «Активна».`,
      );
      this.logger.log(`[launch] ${company.name}: первый разбор, launch → active`);
      return;
    }

    // Записи ПОСЛЕ запуска и только сданные: черновик до РОПа не доехал, а старые записи
    // к новому запуску отношения не имеют.
    const entriesSinceLaunch = await this.entryRepo.count({
      where: {
        companyId: company.id,
        status: Not(EntryStatus.DRAFT),
        createdAt: MoreThanOrEqual(since),
      },
    });
    if (entriesSinceLaunch > 0) return; // записи пошли — тишины нет, ждём первого разбора

    const hoursSince = Math.floor((Date.now() - new Date(company.launchedAt as Date).getTime()) / 3_600_000);
    if (hoursSince === 48) {
      await this.notifyStaff(
        company,
        'Тишина после запуска',
        `Компания «${company.name}»: 48 часов после старта, ни одной записи не загружено. Свяжитесь с командой.`,
      );
      // РОПу лично: он ближе всех к менеджерам и может завести работу изнутри.
      const reviewers = await this.userRepo.find({
        where: { companyId: company.id, role: UserRole.REVIEWER, isActive: true },
      });
      for (const rop of reviewers) {
        const contact = await this.telegram.findContactByUserId(rop.id);
        if (!contact) continue;
        await this.telegram.sendMessage(
          contact.chatId,
          `Мы запустили «Работу над ошибками» два дня назад, но записей от менеджеров пока нет. ` +
            `Попросите команду загрузить первые звонки: ${process.env.APP_URL || 'https://app.example.invalid'}/sprint`,
        );
      }
      this.logger.log(`[launch] ${company.name}: тишина 48 ч, сигналы отправлены`);
    } else if (hoursSince === 120 && company.telegramWorkChatId) {
      await this.telegram.sendMessage(
        company.telegramWorkChatId,
        `Коллеги, напоминаем про «Работу над ошибками»: записей пока нет. ` +
          `Начните с одного звонка, это 10 минут: ${process.env.APP_URL || 'https://app.example.invalid'}\n` +
          `Доступы каждого лежат в сообщении о старте выше. Если вход не получается, напишите нам, поможем.`,
      );
      await this.notifyStaff(
        company,
        'Тишина после запуска: 5 дней',
        `Компания «${company.name}»: 5 дней после старта без единой записи. Команде ушло напоминание в рабочий чат, подключитесь лично.`,
      );
      this.logger.log(`[launch] ${company.name}: тишина 5 дней, напоминание в чат`);
    }
  }

  private async notifyStaff(company: Company, title: string, message: string): Promise<void> {
    const staff = await this.userRepo.find({
      where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
    });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.LAUNCH,
        title,
        message,
        linkUrl: `/admin/company/${company.id}`,
      });
    }
    // Веха запуска: событие, о котором иначе не узнать, и каждое поднимается один раз.
    await this.notifier.alert('launch', `🚀 <b>${esc(title)}</b>\n${esc(message)}`);
  }
}
