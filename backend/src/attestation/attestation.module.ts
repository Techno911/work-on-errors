import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttestationTest } from './entities/attestation-test.entity';
import { AttestationQuestion } from './entities/attestation-question.entity';
import { AttestationAttempt } from './entities/attestation-attempt.entity';
import { AttestationAnswer } from './entities/attestation-answer.entity';
import { PlaybookCard } from '../playbook/entities/playbook-card.entity';
import { AttestationService } from './attestation.service';
import { AttestationController } from './attestation.controller';
import { AttestationQuizScheduler } from './attestation-quiz.scheduler';
import { LlmModule } from '../llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { Company } from '../companies/entities/company.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AttestationTest, AttestationQuestion, AttestationAttempt, AttestationAnswer, PlaybookCard, Company]),
    LlmModule,
    NotificationsModule,
    UsersModule,
  ],
  controllers: [AttestationController],
  providers: [AttestationService, AttestationQuizScheduler],
})
export class AttestationModule {}
