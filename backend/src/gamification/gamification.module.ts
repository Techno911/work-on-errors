import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserGamification } from './entities/user-gamification.entity';
import { Achievement } from './entities/achievement.entity';
import { XpTransaction } from './entities/xp-transaction.entity';
import { GamificationService } from './gamification.service';
import { GamificationController } from './gamification.controller';
import { User } from '../users/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { CompaniesModule } from '../companies/companies.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserGamification, Achievement, XpTransaction, User, Company]),
    CompaniesModule,
  ],
  providers: [GamificationService],
  controllers: [GamificationController],
  exports: [GamificationService],
})
export class GamificationModule {}
