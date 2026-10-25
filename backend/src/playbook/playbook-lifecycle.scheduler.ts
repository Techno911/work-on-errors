import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { PlaybookCard, PlaybookCardStatus } from './entities/playbook-card.entity';
import { Company } from '../companies/entities/company.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';
import { localParts } from '../common/company-time.util';
import { canSignalClient } from '../companies/signal-audience.util';

// Ошибка, о которой давно не было ни одного нового случая — похоже, команда перестала так
// ошибаться. Порог шире окна детекции (42 дня): не хотим гасить карточку раньше, чем истечёт
// даже её собственное окно повтора.
const AUTO_RESOLVED_SILENCE_DAYS = 60;

/**
 * Release 4 плана «Методичка» (живой цикл, 28.07.2026): методичка не должна протухать молча.
 * Раз в сутки в 9:00 по времени компании — два независимых напоминания:
 *   1. Карточка просрочила квартальный пересмотр (reviewDueAt) — РОП подтверждает заново.
 *   2. Карточка давно не встречалась в разборах — подсказка «возможно, решено», не приказ:
 *      решение архивировать или оставить всегда за РОПом.
 */
@Injectable()
export class PlaybookLifecycleScheduler {
  private readonly logger = new Logger(PlaybookLifecycleScheduler.name);

  constructor(
    @InjectRepository(PlaybookCard) private readonly cardRepo: Repository<PlaybookCard>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  @Cron('0 * * * *', { name: 'playbook-lifecycle' })
  async handleHourly(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      // Напоминания по методичке уходят РОПу и владельцу: та же аудитория, тот же фильтр.
      if (!canSignalClient(company)) continue;
      if (localParts(company.timezone).hour !== 9) continue;
      try {
        await this.processCompany(company.id);
      } catch (e) {
        this.logger.warn(`playbook-lifecycle для ${company.id}: ${(e as Error).message}`);
      }
    }
  }

  private async processCompany(companyId: string): Promise<void> {
    await this.notifyOverdue(companyId);
    await this.markAutoResolved(companyId);
  }

  private async notifyOverdue(companyId: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const overdue = await this.cardRepo
      .createQueryBuilder('card')
      .where('card.companyId = :companyId', { companyId })
      .andWhere('card.status = :status', { status: PlaybookCardStatus.ACTIVE })
      .andWhere('card."reviewDueAt" < :today', { today })
      .andWhere('(card."overdueNotifiedAt" IS NULL OR card."overdueNotifiedAt" < :since)', {
        since: new Date(Date.now() - 30 * 24 * 3600 * 1000), // не чаще раза в месяц на одну карточку
      })
      .getMany();
    if (!overdue.length) return;

    const targets = (await this.usersService.findAll(companyId)).filter(
      (u) => u.role === UserRole.REVIEWER || u.role === UserRole.OWNER,
    );
    for (const card of overdue) {
      for (const u of targets) {
        await this.notificationsService.create({
          userId: u.id,
          type: NotificationType.PLAYBOOK_CANDIDATE,
          title: 'Карточка методички просрочила пересмотр',
          message: `«${card.title}»: квартальный срок прошёл. Загляните и подтвердите правило заново — иначе оно не попадёт в следующую аттестацию.`,
          relatedId: card.id,
          linkUrl: '/playbook',
        });
      }
      await this.cardRepo.update({ id: card.id }, { overdueNotifiedAt: new Date() });
    }
  }

  private async markAutoResolved(companyId: string): Promise<void> {
    const silenceSince = new Date(Date.now() - AUTO_RESOLVED_SILENCE_DAYS * 24 * 3600 * 1000);
    await this.cardRepo.update(
      {
        companyId,
        status: PlaybookCardStatus.ACTIVE,
        autoResolvedHint: false,
        lastOccurrenceAt: LessThan(silenceSince),
      },
      { autoResolvedHint: true },
    );
  }
}
