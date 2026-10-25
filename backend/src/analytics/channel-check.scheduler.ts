import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TelegramService, escapeTelegramHtml as esc } from './telegram.service';
import { StaffNotifierService, StaffSignal } from './staff-notifier.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';
import { isUnderOurWatch } from '../companies/signal-audience.util';

export interface ChannelCheckResult {
  companyId: string;
  companyName: string;
  problems: string[];
  checked: number;
}

/**
 * Еженедельная проверка каналов связи (волна 3 разбора жизненного цикла).
 *
 * Дефект, который она закрывает: отсутствие канала ведёт себя ровно так же, как настроенный
 * канал, в который нечего отправить. Код тихо выходит и не оставляет следа, поэтому «сигналов
 * не было» и «сигналы некуда слать» неотличимы. У клиента так молчали ВСЕ каналы разом: ни у
 * владельца, ни у РОПа не было привязки к боту, а список чатов компании был пуст.
 *
 * Проверяем то, что можно проверить не отправляя человеку ничего лишнего: жив ли чат (getChat),
 * объявлены ли адреса, есть ли личная привязка у владельца и РОПа. Результат пишется в журнал
 * компании — тогда на вопрос «а канал вообще живой» отвечает платформа, а не память.
 */
@Injectable()
export class ChannelCheckScheduler {
  private readonly logger = new Logger(ChannelCheckScheduler.name);

  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
    private readonly events: CompanyEventsService,
    private readonly notifier: StaffNotifierService,
  ) {}

  // Понедельник 08:00 по серверу: до недельных отчётов, чтобы поломка канала всплыла раньше,
  // чем в него уйдёт отчёт.
  @Cron('0 8 * * 1', { name: 'channel-check' })
  async weekly(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    const broken: ChannelCheckResult[] = [];
    // Компании, чью проверку выполнить не удалось. Проверка ходит в Telegram по каждому чату
    // (isChatAlive), поэтому сетевой сбой здесь штатный сценарий, а не редкость.
    const failed: { id: string; name: string; reason: string }[] = [];
    for (const company of companies) {
      if (!isUnderOurWatch(company)) continue;
      try {
        const res = await this.checkCompany(company);
        if (res.problems.length) broken.push(res);
      } catch (err) {
        const reason = (err as Error).message;
        this.logger.error(`channel-check ${company.name}: ${reason}`);
        failed.push({ id: company.id, name: company.name, reason });
      }
    }
    // Свод отдаётся ВСЕГДА, даже пустой: это отметка о прогоне (сторож жив) плюс закрытие
    // тех поломок, которые чинились с прошлой недели. Решение «сказать или промолчать»
    // принимает StaffNotifierService, а не наличие проблем здесь.
    await this.reportToStaff(broken, failed);
    this.logger.log(`[channel-check] проверено компаний с проблемами: ${broken.length}`);
  }

  /** Проверка одной компании. Ничего не отправляет клиенту: только читает состояние каналов. */
  async checkCompany(company: Company): Promise<ChannelCheckResult> {
    const problems: string[] = [];
    let checked = 0;

    // 1. Рабочий чат команды: туда уходят доступы, kick-off и напоминания.
    if (!company.telegramWorkChatId) {
      problems.push('рабочий чат не подключён');
    } else {
      checked++;
      const alive = await this.telegram.isChatAlive(company.telegramWorkChatId);
      if (!alive) problems.push('рабочий чат не отвечает: бота могли удалить из чата');
    }

    // 2. Каналы владельца: недельный отчёт и все эскалации идут сюда.
    const wa = company.reportChannels?.weeklyAccountability ?? {};
    const chats = wa.telegramChatIds ?? [];
    const emails = wa.emails ?? [];
    if (chats.length === 0 && emails.length === 0) {
      problems.push('у владельца не объявлено ни одного канала: отчёты уходить некуда');
    }
    // Проверка «есть хоть один канал» была слишком щедрой: три срочных сигнала (просрочка
    // ревью, пятничная эскалация долга, невостребованный доступ) до 09.08.2026 умели только
    // Telegram, поэтому клиент с одной лишь почтой считался на связи, а сигналы не уходили
    // никуда. Сейчас у них есть почтовый запасной путь, но разница в скорости осталась:
    // письмо про просроченный разбор читают в лучшем случае вечером.
    const ownerPersonal = await this.countOwnerPersonalChats(company.id);
    if (chats.length === 0 && ownerPersonal === 0 && emails.length > 0) {
      problems.push('у владельца только почта: срочные сигналы придут письмом, а не сразу');
    }
    for (const chatId of chats) {
      checked++;
      const alive = await this.telegram.isChatAlive(chatId);
      if (!alive) problems.push(`чат владельца ${chatId} не отвечает`);
    }

    // 3. Личные привязки: без них дайджест РОПа и личные напоминания молча не доходят.
    const people = await this.userRepo.find({
      where: [
        { companyId: company.id, role: UserRole.REVIEWER, isActive: true },
        { companyId: company.id, role: UserRole.OWNER, isActive: true },
      ],
    });
    for (const person of people) {
      const contact = await this.telegram.findContactByUserId(person.id);
      if (!contact) {
        problems.push(
          `${person.fullName} (${person.role === UserRole.REVIEWER ? 'РОП' : 'владелец'}) не подключил личный Telegram`,
        );
      }
    }

    await this.events.log({
      companyId: company.id,
      type: CompanyEventType.CHANNEL_CHECK,
      title: problems.length ? `Проверка каналов: ${problems.length} проблем` : 'Проверка каналов: всё живо',
      details: problems.length ? problems.join('; ') : `Проверено адресов: ${checked}.`,
      payload: { problems, checked },
    });

    return { companyId: company.id, companyName: company.name, problems, checked };
  }

  /** Сколько владельцев компании подключили личный Telegram. */
  private async countOwnerPersonalChats(companyId: string): Promise<number> {
    const owners = await this.userRepo.find({
      where: { companyId, role: UserRole.OWNER, isActive: true },
    });
    let n = 0;
    for (const owner of owners) {
      if (await this.telegram.findContactByUserId(owner.id)) n++;
    }
    return n;
  }

  private async reportToStaff(
    broken: ChannelCheckResult[],
    failed: { id: string; name: string; reason: string }[] = [],
  ): Promise<void> {
    const message = broken
      .map((b) => `${b.companyName}: ${b.problems.join('; ')}`)
      .join('\n');

    if (broken.length) {
      const staff = await this.userRepo.find({
        where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
      });
      for (const s of staff) {
        await this.notifications.create({
          userId: s.id,
          type: NotificationType.LAUNCH,
          title: 'Каналы связи: есть поломки',
          message,
          linkUrl: '/',
        });
      }
    }

    // Ступень это состав поломок у компании: сломался ещё один канал — новость, та же
    // поломка вторую неделю подряд — нет, о ней напомнит срок повтора внутри нотификатора.
    const signals: StaffSignal[] = broken.map((b) => ({
      id: `channel:${b.companyId}`,
      stage: b.problems.join('; '),
      text: `🔌 <b>${esc(b.companyName)}</b>: ${esc(b.problems.join('; '))}`,
    }));

    // Чаты НАШЕЙ стороны проверяются наравне с клиентскими. Без этого мёртвый чат владельца
    // или трекера не виден ниоткуда: сообщение уходит, отправитель считает его доставленным
    // хотя бы одному, и потеря остаётся молчаливой. Здесь она становится строкой с починкой.
    for (const chatId of await this.notifier.deadChats()) {
      signals.push({
        id: `staffchat:${chatId}`,
        text: `📵 Чат нашей стороны ${esc(chatId)} не отвечает: сигналы платформы туда не доходят. Проверьте, не заблокирован ли бот.`,
      });
    }

    // Сбой самой проверки это НОВОСТЬ, а не тишина: пока он висит, про каналы этой компании
    // не известно ничего. Отдельной строкой человеку и отдельным списком нотификатору, чтобы
    // прежние поломки этой компании не были закрыты как исчезнувшие.
    for (const f of failed) {
      signals.push({
        id: `checkfail:${f.id}`,
        stage: f.reason.slice(0, 40),
        text: `⚠️ <b>${esc(f.name)}</b>: проверку каналов выполнить не удалось (${esc(f.reason)}). Состояние каналов неизвестно.`,
      });
    }

    await this.notifier.report('channel-check', '🔌 <b>Проверка каналов связи</b>', signals, {
      unverified: failed.map((f) => `channel:${f.id}`),
    });
  }
}
