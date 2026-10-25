import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { Company, DEFAULT_REVIEW_NORMS } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { escapeTelegramHtml as esc } from './telegram.service';
import { businessHoursBetween, localParts } from '../common/company-time.util';
import { pluralRu } from './weekly-report.scheduler';
import { OwnerReachService } from './owner-reach.service';
import { canSignalClient } from '../companies/signal-audience.util';

/**
 * Ежедневный алерт о записях, ждущих ревью дольше company.reviewNorms.maxHoursToRespond часов.
 * Логика:
 *   - Для каждой компании находим записи status=submitted, createdAt старше порога.
 *   - Шлём владельцу по всем его адресам через OwnerReachService.
 *
 * До 09.08.2026 алерт умел ровно один вид адреса (reportChannels.telegramChatIds) и молча
 * выходил, если список пуст. У обоих живых клиентов он был пуст, поэтому главный норматив
 * продукта (разбор за 24 часа) не имел адреса доставки НИ У КОГО, а в логах не оставалось
 * даже следа: выход стоял до строки лога.
 */
@Injectable()
export class OverdueScheduler {
  private readonly logger = new Logger(OverdueScheduler.name);

  constructor(
    @InjectRepository(Entry)
    private readonly entryRepo: Repository<Entry>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly ownerReach: OwnerReachService,
  ) {}

  // Ежечасно: алерт уходит в 10:00 локального времени компании
  @Cron('0 * * * *', { name: 'overdue-reviews-alert' })
  async handleDaily(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      if (!canSignalClient(company)) continue;
      if (localParts(company.timezone).hour !== 10) continue;
      try {
        await this.processCompany(company);
      } catch (err) {
        this.logger.error(`overdue for ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  private async processCompany(company: Company): Promise<void> {
    const maxHours = company.reviewNorms?.maxHoursToRespond ?? DEFAULT_REVIEW_NORMS.maxHoursToRespond;
    // Кандидаты берём по календарному времени (грубый отсев в базе), а решение принимаем по
    // РАБОЧИМ часам: норматив разбора это рабочее время руководителя. Считать подряд значит
    // записывать в просрочку выходные и ночь, а такой отчёт собственник читает как провал
    // дисциплины там, где человек ответил в первое же рабочее утро.
    const waiting = await this.entryRepo
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.manager', 'manager')
      .where('entry.companyId = :companyId', { companyId: company.id })
      .andWhere('entry.status = :status', { status: EntryStatus.SUBMITTED })
      .andWhere('COALESCE(entry.submittedAt, entry.createdAt) <= :threshold', {
        threshold: new Date(Date.now() - maxHours * 3600 * 1000),
      })
      .andWhere('entry.deletedAt IS NULL')
      .getMany();
    const overdue = waiting.filter(
      e => businessHoursBetween(company.timezone, e.submittedAt ?? e.createdAt) > maxHours,
    );
    if (overdue.length === 0) return;

    // Сводка по менеджерам
    const byManager = new Map<string, number>();
    for (const e of overdue) {
      const name = e.manager?.fullName ?? '—';
      byManager.set(name, (byManager.get(name) ?? 0) + 1);
    }
    const managersList = Array.from(byManager.entries())
      .map(([n, c]) => `• <b>${esc(n)}</b>: ${c}`)
      .join('\n');

    // OVR1: было только «1» и «N» — «2 записей ждут» грамматически неверно (нужна форма «записи»
    // для 2–4). pluralRu уже даёт правильные три формы, определяем глагол по форме существительного.
    const noun = pluralRu(overdue.length, 'запись', 'записи', 'записей');
    const verb = noun === 'запись' ? 'ждёт' : 'ждут';
    const msg =
      `🚨 <b>${esc(company.name)}</b>: просроченные ревью\n` +
      `${overdue.length} ${noun} ${verb} ревью дольше ${maxHours}ч:\n\n` +
      `${managersList}\n\n` +
      `Платформа: ${process.env.APP_URL || 'https://app.example.invalid'}/`;

    const emailHtml =
      `<p><b>${company.name}</b>: просроченные ревью.</p>` +
      `<p>${overdue.length} ${noun} ${verb} ревью дольше ${maxHours} часов:</p>` +
      `<ul>${Array.from(byManager.entries()).map(([n, c]) => `<li>${n}: ${c}</li>`).join('')}</ul>` +
      `<p><a href="${process.env.APP_URL || 'https://app.example.invalid'}/">Открыть платформу</a></p>`;

    const delivery = await this.ownerReach.deliver(company, {
      kind: 'overdue',
      // Сторож ежедневный: в Telegram это нормально, письмом каждый день — спам,
      // который перестают читать. Почта повторяется не чаще раза в трое суток.
      emailCooldownDays: 3,
      tgHtml: msg,
      subject: `${company.name}: ревью просрочено`,
      emailHtml,
    });
    // Лог пишется ВСЕГДА, даже когда доставить некуда: раньше выход стоял до этой строки,
    // и «адресов нет» было неотличимо от «просрочек нет».
    this.logger.log(
      `[overdue] ${company.name}: ${overdue.length} overdue, ` +
        `доставлено чатов=${delivery.chats}, писем=${delivery.emails}`,
    );
  }
}
