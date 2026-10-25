import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../companies/entities/company.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { Entry } from '../entries/entities/entry.entity';
import { User } from '../users/entities/user.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { AnalyticsModule } from '../analytics/analytics.module';
import { RopBonusModule } from '../rop-bonus/rop-bonus.module';
import { RopBonusOfferModule } from '../rop-bonus-offer/rop-bonus-offer.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Sprint, Entry, User, RefreshToken]), AnalyticsModule, RopBonusModule, RopBonusOfferModule, AuthModule, NotificationsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
