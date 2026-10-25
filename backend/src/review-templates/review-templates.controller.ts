import {
  Controller, Get, Post, Put, Delete, Param, Body, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { ReviewTemplatesService } from './review-templates.service';
import { CreateReviewTemplateDto, UpdateReviewTemplateDto } from './dto/create-review-template.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('companies/:companyId/review-templates')
@UseGuards(JwtAuthGuard)
export class ReviewTemplatesController {
  constructor(private readonly service: ReviewTemplatesService) {}

  /**
   * GET /companies/:companyId/review-templates — список шаблонов.
   * Reviewer получает пустой массив, если собственник не включил ему доступ.
   */
  @Get()
  async findAll(@Param('companyId') companyId: string, @CurrentUser() user: User) {
    if (user.role !== 'superadmin' && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    if (user.role === 'reviewer') {
      const allowed = await this.service.canReviewerUseTemplates(companyId);
      if (!allowed) return [];
    }
    return this.service.findAll(companyId);
  }

  /** POST /companies/:companyId/review-templates */
  @Post()
  async create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateReviewTemplateDto,
    @CurrentUser() user: User,
  ) {
    await this.service.assertCanEdit(user.companyId, companyId, user.role);
    return this.service.create(companyId, dto, user.id, user.fullName);
  }

  /** PUT /companies/:companyId/review-templates/:id */
  @Put(':id')
  async update(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateReviewTemplateDto,
    @CurrentUser() user: User,
  ) {
    await this.service.assertCanEdit(user.companyId, companyId, user.role);
    return this.service.update(id, companyId, dto, user.id, user.fullName);
  }

  /** DELETE /companies/:companyId/review-templates/:id — деактивация */
  @Delete(':id')
  async deactivate(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    await this.service.assertCanEdit(user.companyId, companyId, user.role);
    return this.service.deactivate(id, companyId);
  }

  /** GET /companies/:companyId/review-templates/:id/history */
  @Get(':id/history')
  async getHistory(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @CurrentUser() user: User,
  ) {
    if (user.role !== 'superadmin' && user.companyId !== companyId) {
      throw new ForbiddenException();
    }
    if (user.role === 'reviewer') {
      const allowed = await this.service.canReviewerUseTemplates(companyId);
      if (!allowed) throw new ForbiddenException();
    }
    return this.service.getHistory(id, companyId);
  }
}
