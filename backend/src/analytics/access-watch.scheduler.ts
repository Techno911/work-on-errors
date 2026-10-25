import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { TEAM_ROLES, UserRole } from '../users/enums/user-role.enum';
import { localParts, workingDaysSince } from '../common/company-time.util';
import { TelegramService, escapeTelegramHtml as esc } from './telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { OwnerReachService } from './owner-reach.service';
import { canSignalClient, isUnderOurWatch } from '../companies/signal-audience.util';

/**
 * Сторож выданных доступов: человека завели, а он не вошёл.
 *
 * Разбор клиента 05.08.2026: двух менеджеров завели 30 июля, пароли ушли владельцу в переписку,
 * ни один не вошёл, и об этом четыре дня не узнал никто. Причина не в людях и не в поломке:
 * выдача доступа не порождала события, а значит сигналу неоткуда было взяться. Здесь ожидание
 * («выдали доступ, значит человек войдёт») становится наблюдаемым и просроченным.
 *
 * Пороги в РАБОЧИХ днях по календарю компании, чтобы пятничная выдача не эскалировалась в
 * понедельник за то, что человек не работал в выходные:
 *   - 2 рабочих дня без входа → РОПу (он ответственный за подключение), владельцу и нам;
 *   - дальше строка держится в ежедневном своде здоровья, пока подключение не закрыто.
 *
 * Сигнал уходит ОДИН раз на человека (идемпотентность по уже созданному уведомлению),
 * иначе ежечасный крон превратит его в поток.
 */
@Injectable()
export class AccessWatchScheduler {
  private readonly logger = new Logger(AccessWatchScheduler.name);

  /** Через сколько рабочих дней без входа поднимаем тревогу. */
  private static readonly WORKDAYS_BEFORE_ALERT = 2;
  /** Учётки старше этого срока не трогаем: это исторический хвост, а не текущее подключение. */
  private static readonly MAX_AGE_DAYS = 14;

  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
    private readonly ownerReach: OwnerReachService,
  ) {}

  // Ежечасно: разбираем компанию в 10:00 её локального времени (не ночью и не в выходные).
  @Cron('40 * * * *', { name: 'access-watch' })
  async watch(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      if (!isUnderOurWatch(company)) continue;
      const lp = localParts(company.timezone);
      if (lp.hour !== 10 || lp.isoWeekday > 5) continue;
      try {
        await this.checkCompany(company);
      } catch (err) {
        this.logger.error(`access-watch ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  /** Возвращает число поднятых тревог (для ручного прогона и тестов). */
  async checkCompany(company: Company): Promise<number> {
    const candidates = await this.userRepo.find({
      where: { companyId: company.id, isActive: true, lastLoginAt: IsNull() },
    });
    let raised = 0;
    for (const user of candidates) {
      if (!TEAM_ROLES.includes(user.role)) continue;
      const ageDays = (Date.now() - new Date(user.createdAt).getTime()) / 86_400_000;
      if (ageDays > AccessWatchScheduler.MAX_AGE_DAYS) continue;
      if (workingDaysSince(company.timezone, user.createdAt) < AccessWatchScheduler.WORKDAYS_BEFORE_ALERT) continue;
      if (await this.notifications.existsFor(NotificationType.ACCESS_NOT_USED, user.id)) continue;
      await this.raise(company, user);
      raised++;
    }
    if (raised) this.logger.log(`[access-watch] ${company.name}: поднято ${raised}`);
    return raised;
  }

  private async raise(company: Company, user: User): Promise<void> {
    const days = workingDaysSince(company.timezone, user.createdAt);
    const created = new Date(user.createdAt).toLocaleDateString('ru-RU');
    const title = 'Доступ выдан, входа нет';
    const message =
      `${user.fullName}: доступ создан ${created}, вход на платформу так и не состоялся ` +
      `(${days} рабочих дня). Пока человек не вошёл, работа по нему не идёт. ` +
      `Чаще всего причина простая: доступ до него не дошёл.`;

    // Команду клиента не трогаем в двух состояниях сразу, и решает это один источник правды:
    // на паузе работа остановлена по договорённости, при закрытом за неоплату доступе человек
    // физически не может войти, и просить его об этом значит издеваться. Нам сигнал уходит в
    // любом случае (ниже). До 13.08.2026 здесь стояла ручная проверка только паузы.
    const muteClient = !canSignalClient(company);

    // Внутри клиента отвечает РОП: у него ежедневный контакт с менеджерами. Владелец это
    // вторая ступень, тот, кто может надавить. Обоим в колокольчик, плюс личный Telegram РОПу.
    const reviewers = await this.userRepo.find({
      where: { companyId: company.id, role: UserRole.REVIEWER, isActive: true },
    });
    const owners = await this.userRepo.find({
      where: { companyId: company.id, role: UserRole.OWNER, isActive: true },
    });
    for (const person of muteClient ? [] : [...reviewers, ...owners]) {
      if (person.id === user.id) continue; // не сообщаем человеку о нём самом
      await this.notifications.create({
        userId: person.id,
        type: NotificationType.ACCESS_NOT_USED,
        title,
        message,
        linkUrl: '/settings',
        relatedId: user.id,
      });
    }
    for (const rop of muteClient ? [] : reviewers) {
      const contact = await this.telegram.findContactByUserId(rop.id);
      if (!contact) continue;
      await this.telegram.sendMessage(
        contact.chatId,
        `🔑 <b>${esc(company.name)}</b>\n${esc(message)}\n\n` +
          `Платформа: ${process.env.APP_URL || 'https://app.example.invalid'}`,
      );
    }

    // Владельцу по всем его адресам (он заходит редко, колокольчик для него это архив).
    // Раньше здесь стояли только Telegram-каналы отчётности, а у обоих живых клиентов они
    // пусты: сигнал не доходил ни разу. Теперь работает и личная привязка, и письмо.
    if (!muteClient) {
      await this.ownerReach.deliver(company, {
        kind: 'access-not-used',
        tgHtml:
          `🔑 <b>${esc(company.name)}</b>\n${esc(message)}\n\n` +
          `Мы можем отправить доступ в ваш рабочий чат заново, ответьте на это сообщение.`,
        subject: `${company.name}: доступ выдан, входа нет`,
        emailHtml:
          `<p><b>${company.name}</b></p><p>${message}</p>` +
          `<p>Мы можем отправить доступ в ваш рабочий чат заново, ответьте на это письмо.</p>`,
      });
    }

    // Нам: трекеру и суперадмину. Наша сторона доводит человека до первого входа.
    const staff = await this.userRepo.find({
      where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
    });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.ACCESS_NOT_USED,
        title: `${company.name}: доступ выдан, входа нет`,
        message,
        linkUrl: `/admin/company/${company.id}`,
        relatedId: user.id,
      });
    }
    // В Telegram нашей стороне отсюда НЕ пишем: ту же проблему той же ночью печатает строка
    // `access:<компания>` в своде здоровья, и человек получал два сообщения об одном факте
    // (найдено независимой проверкой 09.09.2026). Свод умеет то, чего не умеет разовый
    // сигнал: молчать о повторе, напоминать по сроку и сообщить о снятии. Колокольчик
    // трекеру и суперадмину выше остаётся — он внимания не стоит.
  }
}
