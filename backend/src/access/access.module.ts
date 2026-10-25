import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AccessDeliveryService } from './access-delivery.service';

/**
 * Глобальный модуль доставки доступов: одним и тем же действием пользуются карточка трекера
 * и экран состояния собственника. Держать две копии этой логики нельзя — они разойдутся молча.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, Company]), AnalyticsModule],
  providers: [AccessDeliveryService],
  exports: [AccessDeliveryService],
})
export class AccessModule {}
