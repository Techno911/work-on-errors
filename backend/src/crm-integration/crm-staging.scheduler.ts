import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrmIntegrationService } from './crm-integration.service';

/** Раз в час чистит staging-файлы записей, которые так и не довели до создания записи. */
@Injectable()
export class CrmStagingScheduler {
  constructor(private readonly crmService: CrmIntegrationService) {}

  @Cron('15 * * * *')
  cleanup(): void {
    this.crmService.cleanupStaging();
  }

  /** Раз в час перепроверяет упавшие подключения — транзиентный сбой не должен глушить CRM навсегда. */
  @Cron('45 * * * *')
  retestFailed(): Promise<void> {
    return this.crmService.retestFailedConnections();
  }
}
