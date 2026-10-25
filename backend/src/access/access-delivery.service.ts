import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TelegramService, escapeTelegramHtml } from '../analytics/telegram.service';
import { PLATFORM_URL } from '../admin/launch-message';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';

/**
 * Доставка доступа человеку: одна точка на всю платформу.
 *
 * Раньше «выдать доступ» жило только у трекера в админке, и когда команда клиента не входила,
 * собственник не мог сделать ничего сам (случай клиента). Теперь тем же действием пользуется и
 * экран состояния собственника. Держим это ОДНОЙ функцией, а не двумя похожими: копия
 * преобразования опаснее копии значения — обе честные, и расходятся молча.
 */
@Injectable()
export class AccessDeliveryService {
  /** Сколько живёт именная ссылка первого входа. Трое суток: длиннее — это уже пароль. */
  private static readonly ACTIVATION_TTL_MS = 3 * 24 * 3600 * 1000;

  private static readonly ROLE_LABEL: Partial<Record<UserRole, string>> = {
    [UserRole.OWNER]: 'владелец',
    [UserRole.REVIEWER]: 'РОП',
    [UserRole.MANAGER]: 'менеджер',
  };

  constructor(
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(Company) private readonly companiesRepo: Repository<Company>,
    private readonly telegram: TelegramService,
    private readonly events: CompanyEventsService,
  ) {}

  /**
   * Именная одноразовая ссылка первого входа. Живую ссылку переиспользуем: повторное открытие
   * карточки не должно гасить ту, что уже ушла человеку в чат.
   */
  async issueActivationLink(user: User): Promise<string> {
    const now = Date.now();
    const alive =
      user.activationToken &&
      user.activationTokenExpiresAt &&
      new Date(user.activationTokenExpiresAt).getTime() > now;
    if (!alive) {
      user.activationToken = randomBytes(24).toString('base64url');
      user.activationTokenExpiresAt = new Date(now + AccessDeliveryService.ACTIVATION_TTL_MS);
      await this.usersRepo.save(user);
    }
    return `${PLATFORM_URL}/activate/${user.activationToken}`;
  }

  /**
   * Персональная досылка доступа в рабочий чат: для заведённых после запуска или не получивших
   * сообщение. Пароль не рассылаем вовсе — уходит именная ссылка, по которой человек задаёт
   * пароль сам.
   */
  async sendUserAccess(userId: string, actorId?: string): Promise<{ sent: boolean }> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user || !user.companyId) throw new NotFoundException('Сотрудник не найден');
    const label = AccessDeliveryService.ROLE_LABEL[user.role];
    if (!label) throw new BadRequestException('Доступ в чат отправляется только команде клиента');
    const company = await this.companiesRepo.findOne({ where: { id: user.companyId } });
    if (!company?.telegramWorkChatId) throw new BadRequestException('Рабочий чат компании не подключён');

    const activationUrl = await this.issueActivationLink(user);
    const msg = user.lastLoginAt
      ? `${escapeTelegramHtml(user.fullName)}, напоминаем вход в платформу «Работа над ошибками»:\n` +
        `${escapeTelegramHtml(user.email)} · ${PLATFORM_URL}\n` +
        `Забыли пароль: на странице входа есть «Забыли пароль», письмо придёт на вашу почту.`
      : `${escapeTelegramHtml(user.fullName)}, ваш доступ к платформе «Работа над ошибками»:\n` +
        `${escapeTelegramHtml(user.email)}\n` +
        `Ссылка входа (ваша личная, живёт 3 дня): ${escapeTelegramHtml(activationUrl)}\n` +
        `По ней вы придумаете себе пароль, дальше вход обычный на ${PLATFORM_URL}.`;

    const sent = await this.telegram.sendMessage(company.telegramWorkChatId, msg);
    await this.events.logDelivery(
      company.id,
      'telegram_work_chat',
      sent,
      `доступ для ${user.fullName}`,
    );
    if (!sent) throw new BadRequestException('Не удалось отправить сообщение в рабочий чат');

    await this.events.log({
      companyId: company.id,
      type: CompanyEventType.ACCESS_SENT,
      title: `Доступ отправлен в рабочий чат: ${user.fullName}`,
      details: user.lastLoginAt
        ? 'Человек уже входил: отправлено напоминание входа без новой ссылки.'
        : 'Отправлена именная ссылка первого входа, живёт 3 дня.',
      actorUserId: actorId ?? null,
      payload: { userId: user.id },
    });
    return { sent: true };
  }
}
