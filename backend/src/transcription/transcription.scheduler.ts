import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TranscriptionService } from './transcription.service';

/**
 * Recovery-механизм пайплайна транскрипции: разгребает очередь (лимит параллельных
 * задач провайдера) и возобновляет задачи, осиротевшие после рестарта контейнера.
 */
@Injectable()
export class TranscriptionScheduler {
  private readonly logger = new Logger(TranscriptionScheduler.name);
  // TR3: если resumeStuck() не успевает за 2 минуты (много queued/stuck задач), следующий
  // тик крона стартовал бы ПОВЕРХ ещё идущего — оба видят одни и те же queued-строки и
  // оба создают провайдеру задачу на одну и ту же запись (двойной списание/двойной запрос).
  private running = false;

  constructor(private readonly transcriptionService: TranscriptionService) {}

  @Cron('*/2 * * * *')
  async recover(): Promise<void> {
    if (this.running) {
      this.logger.warn('recovery: предыдущий тик ещё выполняется — пропускаю');
      return;
    }
    this.running = true;
    try {
      await this.transcriptionService.resumeStuck();
    } catch (err) {
      this.logger.error(`recovery: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
