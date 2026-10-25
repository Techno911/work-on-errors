import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { EntriesModule } from '../entries/entries.module';
import { ShareToken } from './entities/share-token.entity';

@Module({
  imports: [JwtModule.register({}), EntriesModule, TypeOrmModule.forFeature([ShareToken])],
  controllers: [ShareController],
  providers: [ShareService],
})
export class ShareModule {}
