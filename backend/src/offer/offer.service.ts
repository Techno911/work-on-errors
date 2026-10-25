import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';

@Injectable()
export class OfferService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepository: Repository<Company>,
    private readonly usersService: UsersService,
  ) {}

  /** Публичная витрина оферты по одноразовому токену (для страницы /offer/:token). */
  async getPublicInfo(token: string): Promise<{
    companyName: string;
    accepted: boolean;
    legalName: string | null;
    inn: string | null;
    trialDays: number;
    licenseMode: 'trial' | 'implementation';
    trialEndsAt: Date | null;
    workStartedAt: Date | null;
  }> {
    const company = await this.companyRepository.findOne({ where: { offerToken: token } });
    if (!company) throw new NotFoundException('Оферта не найдена или уже недействительна');
    // Заказчик в оферте — юрлицо/ИП из договора (legalName), а не бренд. Реквизиты по токену
    // видит только владелец, открывший ссылку, — это его собственные данные.
    // trialDays — точный срок теста (в оферте недопустимо «около месяца», нужна точность).
    // licenseMode — при 'implementation' оферта не показывает счётчик триала (лицензия бесплатна
    // на весь этап внедрения).
    return {
      companyName: company.name,
      accepted: company.offerAcceptedAt !== null,
      legalName: company.legalInfo?.legalName ?? null,
      inn: company.legalInfo?.inn ?? null,
      trialDays: company.trialDays ?? 30,
      licenseMode: company.licenseMode ?? 'trial',
      // Конкретные даты теста: trialEndsAt считается от workStartedAt (см. computeTrialEnd). Пока
      // старт не зафиксирован — null, и оферта показывает динамическую формулировку без даты.
      trialEndsAt: company.trialEndsAt,
      workStartedAt: company.workStartedAt,
    };
  }

  /**
   * Принятие оферты владельцем. Текущий (только что зарегистрированный/залогиненный) пользователь
   * становится владельцем компании, запускается триал. Оферта = договор + согласие на обработку
   * ПДн команды (включая состав из рабочего чата) + старт бесплатного периода.
   * Токен одноразовый — после принятия обнуляется.
   */
  async accept(token: string, userId: string, opts: { pdnConsent: boolean; ip: string | null }): Promise<{ success: boolean; trialEndsAt: Date | null }> {
    const company = await this.companyRepository.findOne({ where: { offerToken: token } });
    if (!company) throw new NotFoundException('Оферта не найдена или уже недействительна');
    if (company.offerAcceptedAt) {
      throw new BadRequestException('Оферта по этой компании уже принята');
    }
    // Согласие на ПДн — отдельный обязательный акт, не подразумевается акцептом оферты (ст. 9 152-ФЗ).
    if (!opts.pdnConsent) {
      throw new BadRequestException('Требуется отдельное согласие на обработку персональных данных');
    }
    // Захват компании: залогиненный сотрудник ЛЮБОЙ компании, зная offer-токен, иначе стал бы
    // владельцем чужой компании. Оферту принимает только новый пользователь без компании.
    const user = await this.usersService.findById(userId).catch(() => null);
    if (user?.companyId) {
      throw new ForbiddenException('Вы уже состоите в компании. Оферту принимает новый владелец с отдельного аккаунта.');
    }

    // Назначаем текущего пользователя владельцем этой компании.
    await this.usersService.updateCompanyAndRole(userId, company.id, UserRole.OWNER);

    // Триал НЕ стартует в момент принятия: бесплатные дни считаются от реальной даты старта
    // работы (workStartedAt — из рабочего ТГ-чата или проставленной вручную). До старта = null.
    const now = new Date();
    company.offerAcceptedAt = now;
    company.pdnConsentAcceptedAt = now;
    company.offerAcceptedIp = opts.ip;
    company.offerToken = null; // одноразовый — гасим
    await this.companyRepository.save(company);

    return { success: true, trialEndsAt: company.trialEndsAt };
  }
}
