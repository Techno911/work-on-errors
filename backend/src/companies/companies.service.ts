import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { DEFAULT_XP_SETTINGS, DEFAULT_ACHIEVEMENT_SETTINGS } from '../gamification/types/gamification-settings.types';
import { CompanyEventsService } from '../company-events/company-events.service';
import { diffNorms } from './norm-diff';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    private readonly usersService: UsersService,
    private readonly events: CompanyEventsService,
  ) {}

  async findAll(): Promise<Company[]> {
    return this.companiesRepository.find({
      order: { createdAt: 'ASC' },
    });
  }

  async findById(id: string): Promise<Company> {
    const company = await this.companiesRepository.findOne({
      where: { id },
      relations: ['users'],
    });
    if (!company) {
      throw new NotFoundException(`Компания с id ${id} не найдена`);
    }
    return company;
  }

  async create(dto: CreateCompanyDto): Promise<Company> {
    const company = this.companiesRepository.create(dto);
    return this.companiesRepository.save(company);
  }

  /**
   * Правка настроек компании. Владелец сохраняет их целиком одной кнопкой, поэтому смену
   * планки команды ловим сравнением значений, а не фактом сохранения: иначе журнал заполнился
   * бы событиями «нормативы изменены» на каждое нажатие «Сохранить».
   *
   * Актор передаётся из контроллера: без него в журнале стоит «система», а весь смысл записи
   * в том, чтобы через месяц ответить на вопрос «кто поднял планку» за секунду.
   */
  async update(id: string, dto: UpdateCompanyDto, actor?: User): Promise<Company> {
    const company = await this.findById(id);
    const before = { ...company } as unknown as Record<string, unknown>;
    Object.assign(company, dto);
    const saved = await this.companiesRepository.save(company);
    await this.events.logNormsChange({
      companyId: id,
      changes: diffNorms(before, saved as unknown as Record<string, unknown>),
      actorUserId: actor?.id ?? null,
      actorLabel: actor?.fullName ?? null,
    });
    return saved;
  }

  async getMembers(companyId: string): Promise<User[]> {
    // Verify company exists
    await this.findById(companyId);
    return this.usersService.findAll(companyId);
  }

  async getSettings(id: string) {
    const company = await this.findById(id);
    return {
      callsEnabled: company.callsEnabled,
      chatsEnabled: company.chatsEnabled,
      callsPerWeek: company.callsPerWeek,
      chatsPerWeek: company.chatsPerWeek,
      minSelfReviewCorrectChars: company.minSelfReviewCorrectChars,
      minSelfReviewImproveChars: company.minSelfReviewImproveChars,
      minSelfReviewSuggestionsChars: company.minSelfReviewSuggestionsChars,
      minReviewChars: company.minReviewChars,
      onboardingCompleted: company.onboardingCompleted,
      thresholdGoodCalls: company.thresholdGoodCalls,
      thresholdGoodChats: company.thresholdGoodChats,
      thresholdGreatCalls: company.thresholdGreatCalls,
      thresholdGreatChats: company.thresholdGreatChats,
      callSources: company.callSources ?? ['Fireflies.ai', 'OTR.AI', 'Вручную'],
      chatSources: company.chatSources ?? ['Instagram', 'Telegram', 'WhatsApp', 'VK', 'Другое'],
      gamificationEnabled: company.gamificationEnabled ?? true,
      reviewerCanEditGamification: company.reviewerCanEditGamification ?? false,
      reviewerCanEditReviewTemplates:
        (company as Company & { reviewerCanEditReviewTemplates?: boolean }).reviewerCanEditReviewTemplates ?? false,
      timezone: company.timezone ?? 'Europe/Moscow',
      managerDeadlineDay: company.managerDeadlineDay,
      reviewerDeadlineDay: company.reviewerDeadlineDay,
      reviewNorms: (company as Company & { reviewNorms?: unknown }).reviewNorms ?? null,
      reportChannels: (company as Company & { reportChannels?: unknown }).reportChannels ?? null,
      ropBonus: (company as Company & { ropBonus?: unknown }).ropBonus ?? null,
      transcription: (company as Company & { transcription?: unknown }).transcription ?? null,
      xpSettings: company.xpSettings ?? DEFAULT_XP_SETTINGS,
      achievementSettings: company.achievementSettings ?? DEFAULT_ACHIEVEMENT_SETTINGS,
    };
  }
}
