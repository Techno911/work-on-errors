import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { AttestationService } from './attestation.service';
import { localParts } from '../common/company-time.util';
import { canSignalClient } from '../companies/signal-audience.util';

/**
 * Release 4 плана «Методичка»: короткий квиз (1-2 вопроса) раз в неделю для действующей
 * команды — план прямо называет причину: «навык растёт от частоты», не от редких больших
 * проверок. Понедельник, 9:00 по времени компании.
 */
@Injectable()
export class AttestationQuizScheduler {
  private readonly logger = new Logger(AttestationQuizScheduler.name);

  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    private readonly attestationService: AttestationService,
  ) {}

  @Cron('0 * * * *', { name: 'attestation-weekly-quiz' })
  async handleHourly(): Promise<void> {
    const companies = await this.companyRepo.find({ where: { isActive: true } });
    for (const company of companies) {
      // Квиз это задание живым менеджерам. Закрытой компании и песочнице его выдавать нельзя,
      // на паузе тоже: работа официально остановлена.
      if (!canSignalClient(company)) continue;
      const local = localParts(company.timezone);
      if (local.hour !== 9 || local.isoWeekday !== 1) continue; // 1 = понедельник
      try {
        const quiz = await this.attestationService.generateAndAssignQuiz(company.id);
        if (quiz) this.logger.log(`Квиз ${quiz.id} создан для ${company.name}`);
      } catch (e) {
        this.logger.warn(`Квиз для ${company.name} не создался: ${(e as Error).message}`);
      }
    }
  }
}
