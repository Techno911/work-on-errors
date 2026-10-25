import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Company, RopBonusSetup } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';

// Предложение премии РОПа собственнику (флоу-аналог оферты, но владелец УЖЕ существует).
// Просмотр лендинга — публичный по токену; применение/правка/отказ — только под входом
// собственника этой компании (закрывает конфликт интересов: РОП сам себе премию не включит).
@Injectable()
export class RopBonusOfferService {
  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * In-app уведомление персоналу ЧиП по дисциплине премии РОПа (колокольчик, с проваливанием
   * в карточку компании). scope='staff' — трекеры + суперадмины (владелец зовёт обсудить);
   * scope='superadmin' — только суперадмины (трекер согласовал условия напрямую и подключил).
   */
  private async notifyStaff(
    company: Company,
    scope: 'staff' | 'superadmin',
    title: string,
    message: string,
  ): Promise<void> {
    const where =
      scope === 'superadmin'
        ? [{ role: UserRole.SUPERADMIN }]
        : [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }];
    const staff = await this.userRepo.find({ where, select: ['id'] });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.ROP_BONUS,
        title,
        message,
        linkUrl: `/admin/company/${company.id}`,
      });
    }
  }

  private clampSetup(s: Partial<RopBonusSetup> | undefined): RopBonusSetup {
    const base = Math.round(Number(s?.baseAmount) || 0);
    const min = Math.round(Number(s?.minThresholdPct));
    const day = s?.payoutDay == null ? null : Math.round(Number(s.payoutDay));
    return {
      baseAmount: base > 0 ? base : 20000,
      minThresholdPct: min >= 1 && min <= 100 ? min : 60,
      payoutDay: day && day >= 1 && day <= 28 ? day : null,
      workdaysOnly: s?.workdaysOnly !== false,
    };
  }

  private async resolveRopName(companyId: string): Promise<string | null> {
    const reviewers = await this.userRepo.find({
      where: { companyId, role: UserRole.REVIEWER, isActive: true },
      select: ['id', 'fullName'],
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    if (reviewers.length === 0) return null;
    if (reviewers.length > 1) return 'руководитель отдела продаж';
    return reviewers[0].fullName ?? null;
  }

  /** Публичная витрина по токену (минимум данных: без ИНН, ФИО подписанта, адресов). */
  async getPublicInfo(token: string) {
    const company = await this.companyRepo
      .createQueryBuilder('c')
      .where(`c.rop_bonus_proposal->>'token' = :token`, { token })
      .getOne();
    if (!company) throw new NotFoundException('Предложение не найдено или уже недействительно');
    const p = company.ropBonusProposal ?? {};
    const setup = (p.decision === 'customized' && p.ownerVariant) || p.draft || null;
    return {
      companyName: company.name,
      ropName: (await this.resolveRopName(company.id)) ?? 'ваш руководитель отдела продаж',
      draft: setup,
      source: p.source ?? 'profile',
      status: p.status ?? 'sent',
      responded: Boolean(p.respondedAt),
      decision: p.decision ?? null,
    };
  }

  /** Загрузить компанию по токену + проверить, что действие совершает собственник этой компании. */
  private async loadForAction(token: string, user: User): Promise<Company> {
    const company = await this.companyRepo
      .createQueryBuilder('c')
      .where(`c.rop_bonus_proposal->>'token' = :token`, { token })
      .getOne();
    if (!company) throw new NotFoundException('Предложение не найдено или уже недействительно');
    const isOwner = user.role === UserRole.OWNER && user.companyId === company.id;
    const isSuperadmin = user.role === UserRole.SUPERADMIN;
    if (!isOwner && !isSuperadmin) {
      throw new ForbiddenException('Решение о премии принимает собственник компании');
    }
    return company;
  }

  /** Принять рекомендованное: применяем в боевой ropBonus (линейная модель, enabled=true). */
  async accept(token: string, user: User) {
    const company = await this.loadForAction(token, user);
    const p = company.ropBonusProposal ?? {};
    if (p.respondedAt) return { alreadyResponded: true, decision: p.decision ?? null };
    const setup = this.clampSetup(p.draft);
    company.ropBonus = {
      ...(company.ropBonus ?? { enabled: false, tiers: [] }),
      enabled: true,
      baseAmount: setup.baseAmount,
      minThresholdPct: setup.minThresholdPct,
      payoutDay: setup.payoutDay,
      workdaysOnly: setup.workdaysOnly,
      declinedExplicitly: false,
    };
    company.ropBonusProposal = {
      ...p,
      status: 'accepted',
      respondedAt: new Date().toISOString(),
      decision: 'recommended',
    };
    await this.companyRepo.save(company);
    return { alreadyResponded: false, decision: 'recommended' as const };
  }

  /** Настроить иначе: сохраняем вариант собственника на согласование трекеру (в прод НЕ пишем). */
  async customize(token: string, user: User, setup: Partial<RopBonusSetup>) {
    const company = await this.loadForAction(token, user);
    const p = company.ropBonusProposal ?? {};
    if (p.respondedAt) return { alreadyResponded: true, decision: p.decision ?? null };
    company.ropBonusProposal = {
      ...p,
      ownerVariant: this.clampSetup(setup),
      status: 'pending_review',
      respondedAt: new Date().toISOString(),
      decision: 'customized',
    };
    await this.companyRepo.save(company);
    return { alreadyResponded: false, decision: 'customized' as const };
  }

  /**
   * Осознанный отказ собственника: премия ВЫКЛЮЧАЕТСЯ и шаг дисциплины закрывается.
   *
   * Одна функция на оба входа (ссылка-лендинг и карточка на главной): 16.09.2026 стало видно,
   * что прежний отказ по ссылке ставил только `declinedExplicitly`, а `enabled` не трогал.
   * Для компании, где премия уже работала, это значило «отказался, а платформа продолжает
   * обещать РОПу деньги»: карточка премии у него на главной остаётся, расчёт уходит в каналы
   * отчётности. Поэтому выключение живёт здесь, а не в каждом вызывающем.
   */
  private applyDecline(company: Company): void {
    const p = company.ropBonusProposal ?? {};
    company.ropBonus = {
      ...(company.ropBonus ?? { enabled: false, tiers: [] }),
      enabled: false,
      declinedExplicitly: true,
    };
    company.ropBonusProposal = {
      ...p,
      status: 'declined',
      respondedAt: new Date().toISOString(),
      decision: 'declined',
    };
  }

  /** Пока не вводим: фиксируем осознанный отказ (шаг дисциплины закрывается). */
  async decline(token: string, user: User) {
    const company = await this.loadForAction(token, user);
    const p = company.ropBonusProposal ?? {};
    if (p.respondedAt) return { alreadyResponded: true, decision: p.decision ?? null };
    this.applyDecline(company);
    await this.companyRepo.save(company);
    return { alreadyResponded: false, decision: 'declined' as const };
  }

  // ── Владелец в мастере онбординга (без токена, по своей companyId) ────────────

  private async loadOwnCompany(user: User): Promise<Company> {
    if (user.role !== UserRole.OWNER || !user.companyId) {
      throw new ForbiddenException('Решение о премии принимает собственник компании');
    }
    const company = await this.companyRepo.findOne({ where: { id: user.companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    return company;
  }

  /** Рекомендованная премия для карточки в мастере: draft трекера, иначе дефолт по практике. */
  async getSelfRecommendation(user: User) {
    const company = await this.loadOwnCompany(user);
    const p = company.ropBonusProposal ?? {};
    return {
      draft: p.draft ?? this.clampSetup(undefined),
      ropName: (await this.resolveRopName(company.id)) ?? 'ваш руководитель отдела продаж',
      responded: Boolean(p.respondedAt),
      decision: p.decision ?? null,
    };
  }

  /** Владелец принимает рекомендованную премию прямо в мастере (без ссылки от трекера). */
  async acceptSelf(user: User) {
    const company = await this.loadOwnCompany(user);
    const p = company.ropBonusProposal ?? {};
    if (p.respondedAt) return { alreadyResponded: true, decision: p.decision ?? null };
    const setup = this.clampSetup(p.draft);
    company.ropBonus = {
      ...(company.ropBonus ?? { enabled: false, tiers: [] }),
      enabled: true,
      baseAmount: setup.baseAmount,
      minThresholdPct: setup.minThresholdPct,
      payoutDay: setup.payoutDay,
      workdaysOnly: setup.workdaysOnly,
      declinedExplicitly: false,
    };
    company.ropBonusProposal = { ...p, draft: setup, status: 'accepted', respondedAt: new Date().toISOString(), decision: 'recommended' };
    await this.companyRepo.save(company);
    return { alreadyResponded: false, decision: 'recommended' as const };
  }

  /**
   * Владелец сам отказывается от премии прямо на главной.
   *
   * Заведено 16.09.2026 по вопросу владельца клиента «сотрудница работает без премии за РнО, можно
   * ей её в системе выключить?». На карточке предложения у него были только «Согласен» и
   * «Обсудить с трекером»: сказать «премия не нужна» было физически нечем, поэтому решение
   * владельца приходило к нам в переписку и исполнялось руками. Отказ по ссылке-лендингу такой
   * кнопкой был с самого начала, у карточки — нет.
   */
  async declineSelf(user: User) {
    const company = await this.loadOwnCompany(user);
    const p = company.ropBonusProposal ?? {};
    if (p.respondedAt) return { alreadyResponded: true, decision: p.decision ?? null };
    this.applyDecline(company);
    await this.companyRepo.save(company);
    return { alreadyResponded: false, decision: 'declined' as const };
  }

  /** Владелец хочет обсудить премию с трекером: в прод НЕ пишем, трекер видит горящий шаг в карточке. */
  async discussSelf(user: User) {
    const company = await this.loadOwnCompany(user);
    const p = company.ropBonusProposal ?? {};
    if (p.respondedAt) return { alreadyResponded: true, decision: p.decision ?? null };
    company.ropBonusProposal = {
      ...p,
      draft: p.draft ?? this.clampSetup(undefined),
      status: 'pending_review',
      respondedAt: new Date().toISOString(),
      decision: 'discuss',
    };
    await this.companyRepo.save(company);
    // Item 3: раньше владелец жал «Обсудить», трекер видел только флаг в карточке, но уведомления
    // в колокольчик не было — запрос легко терялся. Теперь трекер и суперадмин получают его сразу.
    await this.notifyStaff(
      company,
      'staff',
      'Собственник хочет обсудить премию РОПа',
      `Компания «${company.name}»: владелец в мастере онбординга не принял и не отклонил премию, а попросил обсудить условия. Свяжитесь с ним и внесите итог.`,
    );
    return { alreadyResponded: false, decision: 'discuss' as const };
  }

  /**
   * Item 5: бесшовная дисциплина. Трекер обсудил премию с собственником в переписке и вносит итог
   * напрямую — премия подключается сразу (трекер берёт ответственность за согласование), без
   * лендинга-ссылки. Суперадмину падает уведомление «согласовано с трекером» с проваливанием в
   * карточку компании, чтобы видеть, что именно согласовали.
   */
  async applyAgreed(companyId: string, setup: Partial<RopBonusSetup>) {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const s = this.clampSetup(setup);
    company.ropBonus = {
      ...(company.ropBonus ?? { enabled: false, tiers: [] }),
      enabled: true,
      baseAmount: s.baseAmount,
      minThresholdPct: s.minThresholdPct,
      payoutDay: s.payoutDay,
      workdaysOnly: s.workdaysOnly,
      declinedExplicitly: false,
    };
    const p = company.ropBonusProposal ?? {};
    company.ropBonusProposal = {
      ...p,
      draft: s,
      status: 'accepted',
      respondedAt: new Date().toISOString(),
      decision: 'agreed',
    };
    await this.companyRepo.save(company);
    const rub = (n: number) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';
    await this.notifyStaff(
      company,
      'superadmin',
      'Премия РОПа согласована с трекером',
      `Компания «${company.name}»: трекер согласовал с собственником и подключил премию — база ${rub(s.baseAmount)} × % разборов в срок, отсечка ${s.minThresholdPct}%${s.payoutDay ? `, выплата ${s.payoutDay}-го` : ''}.`,
    );
    return { applied: true as const };
  }

  // ── Действия трекера (вызываются из admin-контроллера под его guard) ──────────

  /** Трекер готовит/пересобирает предложение и генерирует ссылку. */
  async prepareProposal(companyId: string, draft: Partial<RopBonusSetup>, source: 'contract' | 'profile') {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const p = company.ropBonusProposal ?? {};
    const token = p.token ?? randomBytes(16).toString('hex');
    company.ropBonusProposal = {
      token,
      status: 'sent',
      draft: this.clampSetup(draft),
      source,
      sentAt: new Date().toISOString(),
      ownerVariant: null,
      respondedAt: null,
      decision: null,
    };
    await this.companyRepo.save(company);
    return { token };
  }

  /** Трекер применяет вариант собственника после согласования (переносит ownerVariant в прод). */
  async applyOwnerVariant(companyId: string) {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const p = company.ropBonusProposal ?? {};
    if (!p.ownerVariant) throw new BadRequestException('Варианта собственника нет');
    const setup = this.clampSetup(p.ownerVariant);
    company.ropBonus = {
      ...(company.ropBonus ?? { enabled: false, tiers: [] }),
      enabled: true,
      baseAmount: setup.baseAmount,
      minThresholdPct: setup.minThresholdPct,
      payoutDay: setup.payoutDay,
      workdaysOnly: setup.workdaysOnly,
      declinedExplicitly: false,
    };
    company.ropBonusProposal = { ...p, status: 'accepted', decision: 'customized' };
    await this.companyRepo.save(company);
    return { applied: true };
  }
}
