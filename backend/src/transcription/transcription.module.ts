import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { User } from '../users/entities/user.entity';
import { EntryAudio } from '../entries/entities/entry-audio.entity';
import { Entry } from '../entries/entities/entry.entity';
import { Company } from '../companies/entities/company.entity';
import { TranscriptionUsage } from './entities/transcription-usage.entity';
import { TranscriptionService } from './transcription.service';
import { TranscriptionScheduler } from './transcription.scheduler';
import { AudioConverterService } from './audio-converter.service';
import { SaluteSpeechProvider } from './providers/salutespeech.provider';
import { GigaamProvider } from './providers/gigaam.provider';
import { TRANSCRIPTION_PROVIDER } from './providers/transcription-provider.interface';
import { TranscriptionController, TranscriptionEntriesController } from './transcription.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EntryAudio, TranscriptionUsage, Entry, Company, User]),
    // Нужен, чтобы отказ распознавания поднимал уведомление трекеру и суперадмину,
    // а не оставался строчкой в логе контейнера (инцидент 25.07.2026).
    NotificationsModule,
    // Нужен ради TelegramService.staffChatIds: адрес нашей стороны собирается из переменной
    // окружения И личных привязок наших людей. Прямой fetch по одной переменной, которая на
    // проде оказалась не задана, отправлял отказы распознавания в никуда (05.08.2026).
    AnalyticsModule,
  ],
  providers: [
    TranscriptionService,
    TranscriptionScheduler,
    AudioConverterService,
    SaluteSpeechProvider,
    GigaamProvider,
    // Активный провайдер распознавания. С 27.07.2026 — свой сервер (GigaAM v3): Сбер с 15.07
    // убрал бесплатные тарифы, а минимальный платёж юрлица 15 000 ₽/мес при нашем расходе
    // около минимального тарифа. Провайдер Сбера оставлен в коде рабочим: откат — замена одной строки ниже.
    { provide: TRANSCRIPTION_PROVIDER, useExisting: GigaamProvider },
  ],
  controllers: [TranscriptionEntriesController, TranscriptionController],
  exports: [TranscriptionService],
})
export class TranscriptionModule {}
