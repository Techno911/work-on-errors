import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ReviewTemplate } from './entities/review-template.entity';
import { ReviewTemplateHistory } from './entities/review-template-history.entity';
import { Company } from '../companies/entities/company.entity';
import { CreateReviewTemplateDto, UpdateReviewTemplateDto } from './dto/create-review-template.dto';

@Injectable()
export class ReviewTemplatesService {
  constructor(
    @InjectRepository(ReviewTemplate)
    private readonly templateRepo: Repository<ReviewTemplate>,
    @InjectRepository(ReviewTemplateHistory)
    private readonly historyRepo: Repository<ReviewTemplateHistory>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
  ) {}

  /**
   * Может ли reviewer конкретной компании видеть и использовать шаблоны ревью.
   * По умолчанию выключено — собственник включает осознанно. Owner / superadmin видят всегда.
   */
  async canReviewerUseTemplates(companyId: string): Promise<boolean> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    return company?.reviewerCanEditReviewTemplates ?? false;
  }

  async findAll(companyId: string): Promise<ReviewTemplate[]> {
    return this.templateRepo.find({
      where: { companyId, isActive: true },
      order: { createdAt: 'ASC' },
    });
  }

  async findById(id: string, companyId: string): Promise<ReviewTemplate> {
    const tpl = await this.templateRepo.findOne({ where: { id, companyId } });
    if (!tpl) throw new NotFoundException('Шаблон не найден');
    return tpl;
  }

  async create(
    companyId: string,
    dto: CreateReviewTemplateDto,
    userId: string,
    userName: string,
  ): Promise<ReviewTemplate> {
    const tpl = this.templateRepo.create({
      companyId,
      name: dto.name,
      content: dto.content,
      version: 1,
      isActive: true,
      createdBy: userId,
      createdByName: userName,
    });
    return this.templateRepo.save(tpl);
  }

  async update(
    id: string,
    companyId: string,
    dto: UpdateReviewTemplateDto,
    userId: string,
    userName: string,
  ): Promise<ReviewTemplate> {
    const tpl = await this.findById(id, companyId);

    // Если обновляется контент — сохраняем историю
    if (dto.content !== undefined && dto.content !== tpl.content) {
      await this.historyRepo.save(
        this.historyRepo.create({
          templateId: tpl.id,
          previousContent: tpl.content,
          newContent: dto.content,
          changedBy: userId,
          changedByName: userName,
          version: tpl.version + 1,
        }),
      );
      tpl.version += 1;
      tpl.createdBy = userId;
      tpl.createdByName = userName;
    }

    if (dto.name !== undefined) tpl.name = dto.name;
    if (dto.content !== undefined) tpl.content = dto.content;
    if (dto.isActive !== undefined) tpl.isActive = dto.isActive;

    return this.templateRepo.save(tpl);
  }

  /** Мягкое удаление — деактивация */
  async deactivate(id: string, companyId: string): Promise<void> {
    const tpl = await this.findById(id, companyId);
    tpl.isActive = false;
    await this.templateRepo.save(tpl);
  }

  async getHistory(id: string, companyId: string): Promise<ReviewTemplateHistory[]> {
    // Проверяем что шаблон принадлежит компании
    await this.findById(id, companyId);
    return this.historyRepo.find({
      where: { templateId: id },
      order: { version: 'DESC' },
    });
  }

  /**
   * Проверка что пользователь может редактировать шаблон компании.
   * Reviewer — только при включённом флаге company.reviewerCanEditReviewTemplates.
   */
  async assertCanEdit(userCompanyId: string | null, companyId: string, userRole: string): Promise<void> {
    if (userRole === 'superadmin') return;
    if (!userCompanyId || userCompanyId !== companyId) throw new ForbiddenException();
    if (userRole === 'owner') return;
    if (userRole === 'reviewer') {
      const allowed = await this.canReviewerUseTemplates(companyId);
      if (!allowed) throw new ForbiddenException('Шаблоны недоступны для вашей роли в этой компании');
      return;
    }
    throw new ForbiddenException();
  }
}
