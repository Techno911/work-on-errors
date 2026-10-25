import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TelegramService } from './telegram.service';
import { sendReportEmail } from './mailer';
import { CompanyEventsService } from '../company-events/company-events.service';

/**
 * Единый адрес владельца для всех сигналов.
 *
 * Разбор 09.08.2026. «Куда писать владельцу» жило в системе в трёх независимых видах:
 * каналы отчётности компании (reportChannels), личная привязка Telegram (telegram_contacts)
 * и почта. Сторожа выбирали из них кто во что горазд: недельный отчёт и расчёт премии умели
 * почту, а просрочка ревью, пятничная эскалация долга и сигнал о невостребованном доступе
 * читали ТОЛЬКО reportChannels.telegramChatIds и молча выходили, если список пуст.
 *
 * На проде это означало, что три сигнала не имели адреса ни у одного живого клиента:
 * у одного клиента и второго заполнена только почта, а у третьего вдобавок есть личные привязки
 * обоих, которыми эти сторожа не пользовались. Проверка каналов и индикатор «петля
 * защищена» при этом показывали зелёное, потому что спрашивали «есть ли хоть один канал»,
 * а сигнал требовал конкретный. Мёртвый канал неотличим от тишины «всё хорошо».
 *
 * Здесь адреса собираются один раз и в порядке убывания скорости: каналы отчётности,
 * личные привязки владельцев, почта. Почта не дублирует Telegram (иначе владелец получал бы
 * одно и то же дважды в день), она включается запасным путём, когда быстрых адресов нет.
 *
 * Рабочий чат команды сюда НЕ входит сознательно: эскалации про РОПа туда слать нельзя,
 * клиент не должен краснеть перед своей командой.
 */

export interface OwnerReach {
  /** Telegram: каналы отчётности плюс личные привязки владельцев, без дублей. */
  chats: string[];
  /** Почта из каналов отчётности. */
  emails: string[];
  /** Есть ли хоть один адрес: если нет, сигнал физически некуда доставить. */
  reachable: boolean;
}

export interface OwnerMessage {
  /**
   * Машинный вид сигнала: «overdue», «debt», «access». По нему считается пауза между
   * ПИСЬМАМИ и ищется прошлая доставка в журнале. Не подпись, а идентификатор: подпись
   * владелец вправе поменять завтра.
   */
  kind: string;
  /** Текст для Telegram (HTML-разметка Telegram). */
  tgHtml: string;
  /** Тема письма запасного пути. */
  subject: string;
  /** Тело письма запасного пути. */
  emailHtml: string;
  /**
   * Сколько суток не повторять ПИСЬМО того же вида. Telegram шлётся с обычной частотой
   * сторожа: там сообщение стоит секунду внимания. Письмо, приходящее каждый день, читать
   * перестают, поэтому у ежедневных сторожей почта работает реже.
   */
  emailCooldownDays?: number;
}

export interface OwnerDelivery {
  chats: number;
  emails: number;
  /** Хоть куда-то доставлено. */
  delivered: boolean;
}

@Injectable()
export class OwnerReachService {
  private readonly logger = new Logger(OwnerReachService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly events: CompanyEventsService,
  ) {}

  /** Все адреса владельца компании. */
  async collect(company: Company): Promise<OwnerReach> {
    const wa = company.reportChannels?.weeklyAccountability ?? {};
    const chats = [...(wa.telegramChatIds ?? [])];

    const owners = await this.userRepo.find({
      where: { companyId: company.id, role: UserRole.OWNER, isActive: true },
    });
    for (const owner of owners) {
      const contact = await this.telegram.findContactByUserId(owner.id);
      if (contact && !chats.includes(contact.chatId)) chats.push(contact.chatId);
    }

    const emails = [...(wa.emails ?? [])];
    return { chats, emails, reachable: chats.length > 0 || emails.length > 0 };
  }

  /**
   * Доставить сигнал владельцу. Telegram основной путь, почта запасной: письмо уходит
   * только когда быстрых адресов нет или отправка в них не прошла целиком.
   */
  async deliver(company: Company, msg: OwnerMessage): Promise<OwnerDelivery> {
    const reach = await this.collect(company);

    let chats = 0;
    if (reach.chats.length) {
      chats = await this.telegram.sendToMany(reach.chats, msg.tgHtml);
      // Каждая попытка доставки с исходом попадает в журнал компании: отказ важнее успеха,
      // он неотличим от тишины, пока не записан.
      await this.events.logDelivery(
        company.id, 'telegram_owner', chats > 0, msg.subject,
        `адресатов: ${reach.chats.length}`, msg.kind,
      );
    }

    let emails = 0;
    if (chats === 0 && reach.emails.length) {
      if (await this.emailOnCooldown(company.id, msg)) {
        this.logger.log(`${company.name}: письмо «${msg.kind}» пропущено, недавно уже уходило`);
      } else {
        try {
          await sendReportEmail(reach.emails, msg.subject, msg.emailHtml);
          emails = reach.emails.length;
          await this.events.logDelivery(
            company.id, 'email_owner', true, msg.subject, `адресатов: ${emails}`, msg.kind,
          );
        } catch (err) {
          this.logger.error(`письмо владельцу ${company.name}: ${(err as Error).message}`);
          await this.events.logDelivery(
            company.id, 'email_owner', false, msg.subject, (err as Error).message, msg.kind,
          );
        }
      }
    }

    if (!reach.reachable) {
      this.logger.warn(`${company.name}: у владельца нет ни одного адреса, сигнал доставить некуда`);
      await this.events.logDelivery(
        company.id, 'email_owner', false, msg.subject,
        'у владельца не объявлено ни одного адреса', msg.kind,
      );
    }
    return { chats, emails, delivered: chats > 0 || emails > 0 };
  }

  /** Уходило ли письмо этого вида недавно. Без паузы ежедневный сторож станет спамом. */
  private async emailOnCooldown(companyId: string, msg: OwnerMessage): Promise<boolean> {
    const days = msg.emailCooldownDays ?? 0;
    if (days <= 0) return false;
    const last = await this.events.lastDeliveryAt(companyId, msg.kind, 'email_owner');
    if (!last) return false;
    return Date.now() - new Date(last).getTime() < days * 86_400_000;
  }
}
