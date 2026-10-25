import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyEvent } from './entities/company-event.entity';
import { CompanyEventsService } from './company-events.service';

/**
 * Глобальный модуль: журнал нужен почти всем (admin, auth, entries, сторожа), а протаскивать
 * его импортом в каждый модуль — гарантированный способ забыть один и потерять часть событий.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([CompanyEvent])],
  providers: [CompanyEventsService],
  exports: [CompanyEventsService],
})
export class CompanyEventsModule {}
