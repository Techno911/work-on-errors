import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { RopBonusOfferService } from './rop-bonus-offer.service';
import { RopBonusOfferController } from './rop-bonus-offer.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Company, User]), NotificationsModule],
  controllers: [RopBonusOfferController],
  providers: [RopBonusOfferService],
  exports: [RopBonusOfferService], // admin.module использует для prepare/apply
})
export class RopBonusOfferModule {}
