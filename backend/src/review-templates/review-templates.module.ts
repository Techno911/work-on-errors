import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReviewTemplate } from './entities/review-template.entity';
import { ReviewTemplateHistory } from './entities/review-template-history.entity';
import { Company } from '../companies/entities/company.entity';
import { ReviewTemplatesService } from './review-templates.service';
import { ReviewTemplatesController } from './review-templates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ReviewTemplate, ReviewTemplateHistory, Company])],
  controllers: [ReviewTemplatesController],
  providers: [ReviewTemplatesService],
  exports: [ReviewTemplatesService],
})
export class ReviewTemplatesModule {}
