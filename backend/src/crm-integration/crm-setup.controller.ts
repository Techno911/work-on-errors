import { Controller, Get, Post, Param, Body, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CrmIntegrationService } from './crm-integration.service';
import { CrmProviderKey } from './entities/crm-connection.entity';

/**
 * Публичная страница подключения CRM по ссылке-поручению (/crm-setup/:token).
 * Открывает её администратор портала клиента — у него нет и не должно быть учётки платформы.
 * Защита: одноразовый непредсказуемый токен с ограниченным сроком (см. createSetupLink),
 * та же валидация портала, что и в кабинете, плюс лимит попыток на этих двух ручках.
 */
@Controller('crm-setup')
@Throttle({ default: { limit: 20, ttl: 60000 } })
export class CrmSetupController {
  constructor(private readonly crmService: CrmIntegrationService) {}

  @Get(':token')
  info(@Param('token') token: string) {
    return this.crmService.getSetupInfo(token);
  }

  @Post(':token')
  submit(
    @Param('token') token: string,
    @Body() dto: { provider: CrmProviderKey; webhookUrl?: string; baseUrl?: string; secret?: string },
  ) {
    if (dto?.provider !== 'bitrix24' && dto?.provider !== 'amocrm') {
      throw new BadRequestException('Выберите CRM: Битрикс24 или amoCRM');
    }
    return this.crmService.submitSetup(token, dto);
  }

  /** «Не получается»: зовём трекера, чтобы человек по ту сторону ссылки не застрял молча. */
  @Post(':token/help')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  help(@Param('token') token: string) {
    return this.crmService.requestSetupHelp(token);
  }
}
