import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaybookCard } from './entities/playbook-card.entity';
import { Entry } from '../entries/entities/entry.entity';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { PlaybookService } from './playbook.service';
import { PlaybookDetectionService } from './playbook-detection.service';
import { PlaybookLifecycleScheduler } from './playbook-lifecycle.scheduler';
import { PlaybookController } from './playbook.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { LlmModule } from '../llm/llm.module';
import { Company } from '../companies/entities/company.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaybookCard, Entry, ErrorTag, Company]),
    NotificationsModule,
    UsersModule,
    LlmModule,
  ],
  controllers: [PlaybookController],
  providers: [PlaybookService, PlaybookDetectionService, PlaybookLifecycleScheduler],
  // PlaybookDetectionService вызывается из EntriesService сразу после ревью с тегами.
  exports: [PlaybookService, PlaybookDetectionService],
})
export class PlaybookModule {}
