import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SeedService } from './seed.service';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { Entry } from '../entries/entities/entry.entity';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { Notification } from '../notifications/entities/notification.entity';
import { ReviewTemplate } from '../review-templates/entities/review-template.entity';
import { UserGamification } from '../gamification/entities/user-gamification.entity';
import { Achievement } from '../gamification/entities/achievement.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, Company, Sprint, Entry, ErrorTag, Notification, ReviewTemplate, UserGamification, Achievement])],
  providers: [SeedService],
})
export class SeedModule {}
