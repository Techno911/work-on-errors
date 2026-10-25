import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmConnection } from './entities/crm-connection.entity';
import { Entry } from '../entries/entities/entry.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { CrmIntegrationService } from './crm-integration.service';
import { CrmIntegrationController } from './crm-integration.controller';
import { CrmSetupController } from './crm-setup.controller';
import { SecretsService } from './secrets.service';
import { Bitrix24Provider } from './providers/bitrix24.provider';
import { AmoCrmProvider } from './providers/amocrm.provider';
import { CrmStagingScheduler } from './crm-staging.scheduler';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [TypeOrmModule.forFeature([CrmConnection, Entry, Company, User]), NotificationsModule, AnalyticsModule],
  providers: [CrmIntegrationService, SecretsService, Bitrix24Provider, AmoCrmProvider, CrmStagingScheduler],
  controllers: [CrmIntegrationController, CrmSetupController],
  exports: [CrmIntegrationService],
})
export class CrmIntegrationModule {}
