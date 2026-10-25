import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { TelegramService, escapeTelegramHtml as esc } from './telegram.service';
import { RopBonusService } from '../rop-bonus/rop-bonus.service';
import { sendReportEmail } from './mailer';
import { localParts } from '../common/company-time.util';
import { canSignalClient } from '../companies/signal-audience.util';
import { emailColor } from '../mail/design-tokens';

const MONTH_LABELS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

/**
 * Расчёт премии РОПа в день выплаты (company.ropBonus.payoutDay).
 * Каждый день 09:00: если сегодня день выплаты — отправляем итог за ПРОШЛЫЙ
 * (закрытый) месяц в каналы отчётности компании (email + Telegram).
 */
@Injectable()
export class RopBonusPayoutScheduler implements OnModuleInit {
  private readonly logger = new Logger(RopBonusPayoutScheduler.name);

  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly telegram: TelegramService,
    private readonly ropBonus: RopBonusService,
  ) {}

  /**
   * Catch-up при старте приложения: любой закрытый месяц без снапшота за последние 12 —
   * даунтайм 1-го числа, деплой, нерабочий cron, или разрыв в несколько месяцев (CALC1-history:
   * демо-компании 2026-02..04 не был frozen) — фиксируем сейчас, чтобы история не «плавала» при смене
   * норматива задним числом. Идемпотентно, безопасно на каждом рестарте.
   */
  async onModuleInit(): Promise<void> {
    try {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 12, 1);
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const created = await this.ropBonus.backfillMissingSnapshots(
        from.getFullYear(), from.getMonth() + 1,
        prev.getFullYear(), prev.getMonth() + 1,
      );
      if (created > 0) {
        this.logger.log(`[startup catch-up] зафиксировано снапшотов за прошлые месяцы: ${created}`);
      }
    } catch (err) {
      this.logger.error(`startup snapshot catch-up: ${(err as Error).message}`);
    }
  }

  /**
   * 1-го числа в 02:00 фиксируем закрытый (прошлый) месяц для ВСЕХ компаний с включённой премией —
   * независимо от payoutDay и каналов рассылки. Письмо в день выплаты затем читает готовый снапшот.
   */
  @Cron('0 2 1 * *', { name: 'rop-bonus-monthly-snapshot' })
  async handleMonthlySnapshot(): Promise<void> {
    try {
      const created = await this.ropBonus.snapshotPreviousMonthForAll();
      this.logger.log(`[monthly snapshot] зафиксировано снапшотов за прошлый месяц: ${created}`);
    } catch (err) {
      this.logger.error(`monthly snapshot: ${(err as Error).message}`);
    }
  }

  // Ежечасно: расчёт уходит в 09:00 локального времени компании в её локальный payoutDay
  @Cron('0 * * * *', { name: 'rop-bonus-payout-report' })
  async handleDaily(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    // Расчёт премии это письмо владельцу: закрытым, демонстрационным и стоящим на паузе
    // компаниям он не адресован.
    for (const company of companies) {
      if (!canSignalClient(company)) continue;
      const lp = localParts(company.timezone);
      if (lp.hour !== 9) continue;
      if (!company.ropBonus?.enabled || !company.ropBonus.payoutDay) continue;
      // CALC8: payoutDay=31 в 30-дневном месяце (или 29/30 в феврале) раньше просто никогда
      // не совпадал с lp.d — отчёт молча не уходил весь месяц. Зажимаем к последнему дню месяца.
      const daysInMonth = new Date(lp.y, lp.m, 0).getDate();
      const effectivePayoutDay = Math.min(company.ropBonus.payoutDay, daysInMonth);
      if (effectivePayoutDay !== lp.d) continue;
      try {
        await this.sendPayoutReport(company);
      } catch (err) {
        this.logger.error(`payout for ${company.name}: ${(err as Error).message}`);
      }
    }
  }

  /** Имя РОПа для письма: при нескольких активных ревьюерах — «Команда ревью», иначе имя. */
  private async resolveRopName(companyId: string): Promise<string | null> {
    const reviewers = await this.userRepo.find({
      where: { companyId, role: UserRole.REVIEWER, isActive: true },
      select: ['id', 'fullName'],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (reviewers.length === 0) return null;
    if (reviewers.length > 1) return 'Команда ревью';
    return reviewers[0].fullName ?? null;
  }

  // public: используется также admin-endpoint'ом «отправить тестовый расчёт»
  // Возвращает false, если каналы не настроены (SCHED1).
  async sendPayoutReport(company: Company): Promise<boolean> {
    const emails = company.reportChannels?.weeklyAccountability?.emails ?? [];
    const tgChats = company.reportChannels?.weeklyAccountability?.telegramChatIds ?? [];
    if (emails.length === 0 && tgChats.length === 0) return false;

    // Закрытый месяц = предыдущий календарный ПО ЛОКАЛЬНОЙ дате компании, не по серверному UTC.
    // Для восточных зон (payoutDay=1, UTC+10..+12) в момент локального 1-го числа 09:00 серверный
    // new Date() ещё в прошлом месяце → уходил бы расчёт за ПОЗАпрошлый месяц (тот же класс, что CALC10).
    const lp = localParts(company.timezone);
    let py = lp.y;
    let pm = lp.m - 1; // 1..12
    if (pm < 1) { pm = 12; py -= 1; }
    const period = `${py}-${String(pm).padStart(2, '0')}`;
    const monthLabel = `${MONTH_LABELS[pm - 1]} ${py}`;

    // Фиксируем закрытый месяц снапшотом — итог не пересчитывается при смене норматива
    const snap = await this.ropBonus.saveSnapshot(company, py, pm);
    const b = {
      onTimePct: snap.onTimePct,
      onTimeCount: snap.onTimeCount,
      lateCount: snap.lateCount,
      shortCount: snap.shortCount ?? 0,
      tiers: snap.tiers ?? [],
      currentAmount: snap.amount,
      maxHoursToRespond: snap.maxHoursToRespond,
    };
    const notCounted = b.lateCount + b.shortCount; // не в зачёте всего
    // Имя из снапшота — зафиксировано на момент расчёта. Fallback: текущий состав ревью.
    const ropName = snap.ropName ?? (await this.resolveRopName(company.id)) ?? 'РОП';
    const pctText = b.onTimePct === null
      ? 'нет данных (записей не было)'
      : `${b.onTimePct}% ревью в зачёте (${b.onTimeCount} из ${b.onTimeCount + notCounted})`;
    const amountText = `${b.currentAmount.toLocaleString('ru-RU')} ₽`;

    // Линейная модель (по договору) показывает формулу; ступени — перечень уровней (легаси).
    const rbLinear = typeof company.ropBonus?.baseAmount === 'number' && company.ropBonus.baseAmount > 0;
    const levelsText = rbLinear
      ? `Расчёт: база ${(company.ropBonus!.baseAmount as number).toLocaleString('ru-RU')} ₽ × % в срок · ниже ${company.ropBonus!.minThresholdPct ?? 60}% премия 0`
      : `Уровни: ${b.tiers.map(t => `от ${t.thresholdPct}% → ${t.amount.toLocaleString('ru-RU')} ₽`).join(' · ') || 'не заданы'}`;

    const tgText =
      `💰 <b>${esc(company.name)}</b>: премия РОПа за ${monthLabel}\n` +
      `${esc(ropName)}: ${pctText}\n` +
      `<b>К выплате сегодня: ${amountText}</b>\n\n` +
      `${esc(levelsText)}\n` +
      '';

    const html = `<!doctype html>
<html lang="ru"><head><meta charset="UTF-8"/><title>Расчёт премии РОПа: ${esc(company.name)}</title>
<style>
body{font-family:-apple-system,'Source Sans 3',sans-serif;background:${emailColor('color-canvas')};padding:24px;color:${emailColor('color-fg')};}
.container{max-width:560px;margin:0 auto;background:${emailColor('color-surface')};border-radius:16px;border:1px solid ${emailColor('color-border')};overflow:hidden}
.header{background:${emailColor('color-accent')};color:${emailColor('color-on-inverse')};padding:24px 32px}
h1{font-size:20px;margin:0 0 6px 0}
.subtitle{opacity:0.85;font-size:14px}
.content{padding:24px 32px}
.amount{font-size:32px;font-weight:700;margin:8px 0}
.muted{color:${emailColor('color-fg-subtle')};font-size:13px}
.footer{padding:16px 32px;background:${emailColor('color-canvas')};border-top:1px solid ${emailColor('color-border')};color:${emailColor('color-fg-disabled')};font-size:12px}
</style></head>
<body><div class="container">
<div class="header"><h1>Расчёт премии РОПа: ${esc(company.name)}</h1>
<div class="subtitle">За ${esc(monthLabel)} · работа над ошибками</div></div>
<div class="content">
<div class="muted"><b>${esc(ropName)}</b> · ${esc(pctText)}</div>
<div class="amount">${amountText}</div>
<div class="muted">К выплате сегодня. Итог зафиксирован в день расчёта и не меняется при изменении норматива.</div>
<div class="muted">${esc(levelsText)}.
Норматив скорости: ревью в пределах ${b.maxHoursToRespond} ч после отправки записи.</div>
</div>
<div class="footer">Платформа «Работа над ошибками»: <a href="${process.env.APP_URL || 'https://app.example.invalid'}/">платформа</a></div>
</div></body></html>`;

    if (tgChats.length > 0) {
      const sent = await this.telegram.sendToMany(tgChats, tgText, { text: 'Открыть расчёт премии', url: (process.env.APP_URL || 'https://app.example.invalid') + '/dashboard' });
      this.logger.log(`[payout/${company.name}] TG sent ${sent}/${tgChats.length}`);
    }
    // COMM2: транзиентный сбой SMTP без повтора терял расчёт премии безвозвратно до
    // следующего дня выплаты (месяц) — один повтор через паузу закрывает основной случай
    // без новой инфраструктуры очередей.
    if (emails.length > 0) {
      const subject = `Премия РОПа за ${monthLabel}: ${amountText}, к выплате сегодня (${company.name})`;
      try {
        await sendReportEmail(emails, subject, html);
        this.logger.log(`[payout/${company.name}] email sent to ${emails.length}`);
      } catch (err) {
        this.logger.warn(`[payout/${company.name}] email error, retrying once: ${(err as Error).message}`);
        try {
          await new Promise((r) => setTimeout(r, 2000));
          await sendReportEmail(emails, subject, html);
          this.logger.log(`[payout/${company.name}] email sent to ${emails.length} on retry`);
        } catch (err2) {
          this.logger.warn(`[payout/${company.name}] email retry failed: ${(err2 as Error).message}`);
        }
      }
    }
    return true;
  }
}
