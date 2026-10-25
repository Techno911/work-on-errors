import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ErrorTag } from './entities/error-tag.entity';
import { ErrorTagsService } from './error-tags.service';
import { ErrorTagsController } from './error-tags.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ErrorTag])],
  controllers: [ErrorTagsController],
  providers: [ErrorTagsService],
  exports: [ErrorTagsService],
})
export class ErrorTagsModule {}
