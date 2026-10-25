import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RopBonusService } from './rop-bonus.service';
import { RopBonusController } from './rop-bonus.controller';
import { Company } from '../companies/entities/company.entity';
import { Entry } from '../entries/entities/entry.entity';
import { RopBonusSnapshot } from './entities/rop-bonus-snapshot.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Entry, RopBonusSnapshot, User])],
  providers: [RopBonusService],
  controllers: [RopBonusController],
  exports: [RopBonusService],
})
export class RopBonusModule {}
