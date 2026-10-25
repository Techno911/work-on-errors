import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Entry } from './entities/entry.entity';
import { EntryScreenshot } from './entities/entry-screenshot.entity';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { EntriesService } from './entries.service';
import { EntriesController } from './entries.controller';
import { CompaniesModule } from '../companies/companies.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { OcrService } from '../common/ocr.service';
import { GamificationModule } from '../gamification/gamification.module';
import { TranscriptionModule } from '../transcription/transcription.module';
import { CrmIntegrationModule } from '../crm-integration/crm-integration.module';
import { PlaybookModule } from '../playbook/playbook.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Entry, EntryScreenshot, ErrorTag, Sprint]),
    forwardRef(() => CompaniesModule),
    NotificationsModule,
    UsersModule,
    GamificationModule,
    TranscriptionModule,
    CrmIntegrationModule,
    PlaybookModule,
  ],
  controllers: [EntriesController],
  providers: [EntriesService, OcrService],
  exports: [EntriesService],
})
export class EntriesModule {}
