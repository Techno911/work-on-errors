import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TelegramService } from './telegram.service';

/**
 * Самопривязка Telegram через deep-link: t.me/<бот>?start=<одноразовый TTL-токен>.
 * Пользователь нажимает Start у бота — /start c payload попадает в getUpdates,
 * «Проверить подключение» связывает chat_id с пользователем платформы.
 * Владельцу чат автоматически дописывается в каналы еженедельного отчёта —
 * ручной шаг «вписать chat_id руками» умирает (не выполнялся у 2 из 2 клиентов).
 *
 * Токен — НЕ userId (был им раньше, TG2): userId не секрет (виден в GET /users
 * всем в компании), поэтому чужую ссылку можно было собрать и перехватить чужие
 * личные дайджесты. issueLinkToken выдаёт случайный одноразовый токен с TTL.
 */
@Controller('telegram-link')
@UseGuards(JwtAuthGuard)
export class TelegramLinkController {
  constructor(
    private readonly telegram: TelegramService,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
  ) {}

  @Get('me')
  async getMyLink(@CurrentUser() user: User) {
    const botUsername = await this.telegram.getBotUsername();
    const contact = await this.telegram.findContactByUserId(user.id);
    const deepLink = botUsername
      ? `https://t.me/${botUsername}?start=${await this.telegram.issueLinkToken(user.id)}`
      : null;
    return {
      enabled: this.telegram.enabled && !!botUsername,
      botUsername,
      deepLink,
      linked: !!contact,
    };
  }

  @Post('check')
  async check(@CurrentUser() user: User) {
    await this.telegram.refreshContacts();
    const contact = await this.telegram.findContactByUserId(user.id);
    if (!contact) return { linked: false, autoWired: false, chatId: null };

    // Владельцу — автопроводка чата в каналы еженедельного отчёта его компании
    let autoWired = false;
    if (user.role === UserRole.OWNER && user.companyId) {
      const company = await this.companyRepo.findOne({ where: { id: user.companyId } });
      if (company) {
        const channels = company.reportChannels ?? { weeklyAccountability: { emails: [], telegramChatIds: [] } };
        const list = channels.weeklyAccountability?.telegramChatIds ?? [];
        if (!list.includes(contact.chatId)) {
          channels.weeklyAccountability = {
            emails: channels.weeklyAccountability?.emails ?? [],
            telegramChatIds: [...list, contact.chatId],
          };
          company.reportChannels = channels;
          await this.companyRepo.save(company);
          autoWired = true;
        }
      }
    }
    return { linked: true, autoWired, chatId: contact.chatId };
  }
}
