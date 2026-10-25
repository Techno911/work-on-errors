import {
  Injectable, Logger, Inject, NotFoundException, ForbiddenException,
  ConflictException, BadRequestException, ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { join } from 'path';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { EntryAudio } from '../entries/entities/entry-audio.entity';
import { Entry } from '../entries/entities/entry.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { StaffNotifierService } from '../analytics/staff-notifier.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { TranscriptionUsage } from './entities/transcription-usage.entity';
import { AudioConverterService } from './audio-converter.service';
import { TRANSCRIPTION_PROVIDER, TranscriptionProvider, Utterance } from './providers/transcription-provider.interface';
import { currentMonthBoundsMs } from '../common/company-time.util';

const MAX_DURATION_SEC = 3 * 3600; // длиннее 3 часов не принимаем
const MAX_PARALLEL_TASKS = 8; // запас от лимита SaluteSpeech в 10 параллельных задач
const POLL_INTERVAL_MS = 15_000;
const POLL_DEADLINE_MS = 40 * 60_000;

/**
 * Оркестратор транскрипции. Без очередей — fire-and-forget цикл в процессе
 * (паттерн processOcr) + recovery-cron на случай рестарта контейнера:
 * задачи у Сбера живут 72 часа, providerTaskId позволяет дорезолвить.
 */
@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);
  // Живые поллинг-циклы этого процесса — чтобы recovery-cron их не дублировал.
  private readonly active = new Set<string>();

  constructor(
    @InjectRepository(EntryAudio) private readonly audioRepo: Repository<EntryAudio>,
    @InjectRepository(TranscriptionUsage) private readonly usageRepo: Repository<TranscriptionUsage>,
    @InjectRepository(Entry) private readonly entryRepo: Repository<Entry>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @Inject(TRANSCRIPTION_PROVIDER) private readonly provider: TranscriptionProvider,
    private readonly converter: AudioConverterService,
    private readonly notifications: NotificationsService,
    private readonly notifier: StaffNotifierService,
  ) {}

  // Отказ провайдера — общий для всех клиентов сбой (кончились деньги, лёг сервис, порвался
  // туннель), поэтому алертим один раз в окно, а не на каждую запись: 25.07.2026 таких
  // отказов было семь подряд, и семь одинаковых уведомлений никому не помогли бы.
  private lastProviderAlertAt = 0;
  private static readonly ALERT_WINDOW_MS = 30 * 60_000;

  /**
   * Сигнал команде «распознавание не работает»: колокольчик трекеру и суперадмину плюс
   * Telegram суперадмину. Заведено после инцидента 25.07.2026, когда SaluteSpeech отвечал
   * 402 Payment Required, это уходило ТОЛЬКО в лог контейнера, и о простое команды клиента
   * мы узнали от него самого через двое суток.
   */
  private async alertProviderDown(reason: string): Promise<void> {
    if (Date.now() - this.lastProviderAlertAt < TranscriptionService.ALERT_WINDOW_MS) return;
    this.lastProviderAlertAt = Date.now();
    const title = 'Распознавание речи не работает';
    const message =
      `Сервис распознавания (${this.provider.name}) отказал: ${reason}. ` +
      `Менеджеры не могут отправить записи звонков на проверку. Проверьте сервис и туннель.`;
    try {
      const staff = await this.usersRepo.find({
        where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }],
      });
      for (const s of staff) {
        await this.notifications.create({
          userId: s.id,
          type: NotificationType.STT_ERROR,
          title,
          message,
          linkUrl: '/admin',
        });
      }
      await this.notifier.alert('stt-error', `⚠️ ${title}\n${message}`);
    } catch (err) {
      // Алерт не должен ломать пайплайн: не смогли сообщить — остаёмся с записью в логе.
      this.logger.error(`alertProviderDown: ${(err as Error).message}`);
    }
  }

  private async findEntryScoped(entryId: string, companyId?: string, ownerId?: string): Promise<Entry> {
    const entry = await this.entryRepo.findOne({ where: companyId ? { id: entryId, companyId } : { id: entryId } });
    if (!entry) throw new NotFoundException('Запись не найдена');
    if (ownerId && entry.managerId !== ownerId) throw new ForbiddenException();
    return entry;
  }

  private async assertEnabled(companyId: string): Promise<Company> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company?.transcription?.enabled) {
      throw new ForbiddenException('Транскрипция не подключена для вашей компании');
    }
    if (!this.provider.enabled) {
      throw new ServiceUnavailableException('Сервис транскрипции не настроен. Обратитесь в поддержку «ЧиП».');
    }
    return company;
  }

  /** Загрузка аудио менеджером: создаёт запись и запускает пайплайн в фоне. */
  async uploadAudio(
    entryId: string,
    file: { path: string; originalname: string; size: number },
    companyId?: string,
    ownerId?: string,
  ): Promise<EntryAudio> {
    const entry = await this.findEntryScoped(entryId, companyId, ownerId);
    await this.assertEnabled(entry.companyId);

    const existing = await this.audioRepo.findOne({ where: { entryId } });
    if (existing) {
      if (['converting', 'queued', 'transcribing'].includes(existing.status)) {
        await unlink(file.path).catch(() => undefined);
        throw new ConflictException('Предыдущий файл ещё обрабатывается — дождитесь завершения');
      }
      await this.deleteAudioFile(existing);
      await this.audioRepo.remove(existing);
    }

    const destName = `${Date.now()}-${Math.round(Math.random() * 1e9)}.mp3`;
    const audio = await this.audioRepo.save(
      this.audioRepo.create({
        entryId,
        fileUrl: `/uploads/audio/${destName}`,
        originalFileName: file.originalname,
        fileSize: file.size,
        status: 'converting',
        provider: this.provider.name,
      }),
    );

    // Фоновый пайплайн — не блокируем ответ менеджеру (паттерн processOcr)
    this.runPipeline(audio.id, file.path, entry.companyId).catch(err =>
      this.logger.error(`Пайплайн транскрипции ${audio.id} упал: ${(err as Error).message}`),
    );
    return audio;
  }

  private async fail(audioId: string, message: string): Promise<void> {
    await this.audioRepo.update(audioId, { status: 'failed', errorMessage: message });
  }

  // Терминальный отказ ПОСЛЕ pre-charge: возвращаем списанные минуты, иначе квота
  // компании тает на неуспешных задачах. Списание привязано к entryAudioId.
  private async failAndRefund(audioId: string, message: string): Promise<void> {
    await this.usageRepo.delete({ entryAudioId: audioId });
    await this.fail(audioId, message);
  }

  private async runPipeline(audioId: string, srcPath: string, companyId: string): Promise<void> {
    const audio = await this.audioRepo.findOne({ where: { id: audioId } });
    if (!audio) return;
    try {
      // 1. Длительность и потолок
      let durationSec: number;
      try {
        durationSec = await this.converter.getDurationSec(srcPath);
      } catch {
        await unlink(srcPath).catch(() => undefined);
        return this.fail(audioId, 'Не удалось прочитать аудиофайл. Проверьте, что это запись звонка (MP3, WAV, M4A или OGG).');
      }
      if (durationSec > MAX_DURATION_SEC) {
        await unlink(srcPath).catch(() => undefined);
        return this.fail(audioId, 'Файл длиннее 3 часов — загрузите запись одного звонка.');
      }

      // 2. Месячный лимит компании (по длительности, до траты денег) — быстрый предфильтр;
      // финальная атомарная проверка+списание — в createProviderTask (TR2).
      const company = await this.companyRepo.findOne({ where: { id: companyId } });
      const limitMin = company?.transcription?.monthlyMinutesLimit ?? null;
      if (limitMin !== null) {
        const used = await this.getMonthUsedSeconds(companyId, company?.timezone);
        if (used + durationSec > limitMin * 60) {
          await unlink(srcPath).catch(() => undefined);
          return this.fail(audioId, 'Лимит минут транскрипции на этот месяц исчерпан. Вставьте текст вручную или обратитесь к владельцу.');
        }
      }

      // 3. Конвертация в MP3 16 кГц и удаление оригинала.
      // Если телефония развела собеседников по каналам (менеджер слева, клиент справа) —
      // сохраняем стерео: провайдер распознает каналы раздельно и соберёт диалог без догадок.
      // Раньше здесь всегда стояло `-ac 1`, и готовое точное разделение говорящих терялось.
      const destAbs = join(process.cwd(), audio.fileUrl.replace(/^\//, ''));
      try {
        const keepStereo = await this.converter.isTrueStereo(srcPath);
        const { fileSize } = await this.converter.convertForStt(srcPath, destAbs, keepStereo);
        await this.audioRepo.update(audioId, { durationSec, fileSize });
      } catch {
        return this.fail(audioId, 'Не удалось обработать аудиофайл. Попробуйте другой формат (MP3 или WAV).');
      } finally {
        await unlink(srcPath).catch(() => undefined);
      }

      // 4. Свободен ли слот у провайдера
      const inFlight = await this.audioRepo.count({ where: { status: 'transcribing' } });
      if (inFlight >= MAX_PARALLEL_TASKS) {
        await this.audioRepo.update(audioId, { status: 'queued' });
        return;
      }

      await this.createProviderTask(audioId, companyId, durationSec, destAbs);
    } catch (err) {
      this.logger.error(`runPipeline ${audioId}: ${(err as Error).message}`);
      await this.fail(audioId, 'Внутренняя ошибка обработки. Вставьте текст вручную или повторите позже.');
    }
  }

  private async createProviderTask(audioId: string, companyId: string, durationSec: number, fileAbsPath: string): Promise<void> {
    // TR2: проверка лимита в runPipeline (шаг 2) — быстрый предфильтр, но между ней и
    // здешним pre-charge проходит конвертация файла (реальное время) — две параллельные
    // загрузки читают один и тот же «использовано» ДО того, как любая из них спишет минуты,
    // и обе проходят. pg_advisory_xact_lock по companyId сериализует check+charge атомарно.
    let usage: TranscriptionUsage;
    try {
      usage = await this.usageRepo.manager.transaction(async (em) => {
        await em.query('SELECT pg_advisory_xact_lock(hashtext($1))', [companyId]);
        const company = await em.findOne(Company, { where: { id: companyId } });
        const limitMin = company?.transcription?.monthlyMinutesLimit ?? null;
        if (limitMin !== null) {
          const { start } = currentMonthBoundsMs(company?.timezone);
          const row = await em
            .createQueryBuilder(TranscriptionUsage, 'u')
            .select('COALESCE(SUM(u.seconds), 0)', 'total')
            .where('u.companyId = :companyId', { companyId })
            .andWhere('u.createdAt >= :start', { start })
            .getRawOne<{ total: string }>();
          const used = parseInt(row?.total ?? '0', 10);
          if (used + durationSec > limitMin * 60) {
            throw new BadRequestException('Лимит минут транскрипции на этот месяц исчерпан. Вставьте текст вручную или обратитесь к владельцу.');
          }
        }
        return em.save(em.create(TranscriptionUsage, { companyId, entryAudioId: audioId, seconds: durationSec }));
      });
    } catch (err) {
      if (err instanceof BadRequestException) {
        return this.fail(audioId, err.message);
      }
      throw err;
    }
    try {
      const { taskId } = await this.provider.createTask(fileAbsPath);
      await this.audioRepo.update(audioId, { status: 'transcribing', providerTaskId: taskId });
      this.pollLoop(audioId).catch(err =>
        this.logger.error(`pollLoop ${audioId}: ${(err as Error).message}`),
      );
    } catch (err) {
      // Ошибка провайдера — не вина клиента, возвращаем минуты
      await this.usageRepo.remove(usage);
      this.logger.error(`createTask ${audioId}: ${(err as Error).message}`);
      await this.alertProviderDown((err as Error).message.slice(0, 200));
      await this.fail(audioId, 'Сервис распознавания временно недоступен. Вставьте текст вручную или повторите позже.');
    }
  }

  // TR1: раньше исключение (сеть/провайдер) внутри цикла улетало из pollLoop() как rejected
  // promise, а вызывающий код (createProviderTask/resumeStuck) только логировал ошибку —
  // status оставался 'transcribing' НАВСЕГДА, задача бессрочно занимала слот из MAX_PARALLEL_TASKS.
  // Даём себе PROVIDER_ERROR_RETRIES попыток на транзиентную ошибку, дальше — честный отказ+возврат минут.
  private static readonly PROVIDER_ERROR_RETRIES = 3;

  private async pollLoop(audioId: string): Promise<void> {
    if (this.active.has(audioId)) return;
    this.active.add(audioId);
    const deadline = Date.now() + POLL_DEADLINE_MS;
    let providerErrors = 0;
    try {
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        const audio = await this.audioRepo.findOne({ where: { id: audioId } });
        if (!audio || audio.status !== 'transcribing' || !audio.providerTaskId) return;

        let result: Awaited<ReturnType<TranscriptionProvider['getResult']>>;
        try {
          result = await this.provider.getResult(audio.providerTaskId);
        } catch (err) {
          providerErrors++;
          this.logger.warn(`getResult ${audioId} попытка ${providerErrors}: ${(err as Error).message}`);
          if (providerErrors >= TranscriptionService.PROVIDER_ERROR_RETRIES) {
            await this.alertProviderDown((err as Error).message.slice(0, 200));
            return this.failAndRefund(audioId, 'Сервис распознавания временно недоступен. Вставьте текст вручную.');
          }
          continue;
        }
        if (result.status === 'processing') {
          // Heartbeat для recovery-cron
          await this.audioRepo.update(audioId, { updatedAt: new Date() });
          continue;
        }
        if (result.status === 'failed') {
          this.logger.warn(`Провайдер вернул ошибку для ${audioId}: ${result.error}`);
          return this.failAndRefund(audioId, 'Не получилось распознать запись. Вставьте текст вручную.');
        }
        return this.finalize(audio, result.utterances);
      }
      // Дедлайн локального поллинга, НЕ терминал: задача у Сбера живёт 72 ч.
      // Помечаем updatedAt протухшим — recovery-cron дорезолвит по providerTaskId,
      // результат не выбрасываем и минуты не возвращаем (задача ещё может завершиться).
      await this.audioRepo.update(audioId, { updatedAt: new Date(Date.now() - 10 * 60_000) });
      this.logger.log(`Поллинг ${audioId} достиг дедлайна — передан recovery-cron'у`);
    } catch (err) {
      // Последний рубеж: что-то совсем неожиданное (не getResult, не БД-запрос сверху) —
      // всё равно освобождаем слот, а не оставляем 'transcribing' висеть навсегда.
      this.logger.error(`pollLoop ${audioId} неожиданная ошибка: ${(err as Error).message}`);
      await this.failAndRefund(audioId, 'Внутренняя ошибка обработки. Вставьте текст вручную или повторите позже.').catch(() => undefined);
    } finally {
      this.active.delete(audioId);
    }
  }

  private async finalize(audio: EntryAudio, utterances: Utterance[]): Promise<void> {
    if (utterances.length === 0) {
      return this.failAndRefund(audio.id, 'Речь не распознана — проверьте, что в файле есть разговор.');
    }
    const text = this.formatDialog(utterances);
    await this.audioRepo.update(audio.id, { status: 'done', transcriptionResult: text, errorMessage: null });

    // Авто-применение только если менеджер не вводил текст руками (не перетираем без подтверждения)
    const entry = await this.entryRepo.findOne({ where: { id: audio.entryId } });
    if (entry && !(entry.transcription ?? '').trim()) {
      await this.entryRepo.update(entry.id, { transcription: text });
      await this.audioRepo.update(audio.id, { appliedAt: new Date() });
    }
  }

  /**
   * «[02:14] Голос 1: …» — реплики одного говорящего подряд склеиваются в один абзац.
   * Таймкод начала реплики выводится, если провайдер вернул тайминг (start в секундах).
   */
  formatDialog(utterances: Utterance[]): string {
    const blocks: { speakerId: number; start?: number; parts: string[] }[] = [];
    for (const u of utterances) {
      const last = blocks[blocks.length - 1];
      // speakerId < 0 = говорящий не определён (модель отдала один поток речи без диаризации).
      // Такие реплики не склеиваем между собой: иначе весь разговор слипся бы в один абзац.
      if (last && u.speakerId >= 0 && last.speakerId === u.speakerId) last.parts.push(u.text);
      else blocks.push({ speakerId: u.speakerId, start: u.start, parts: [u.text] });
    }
    return blocks
      .map(b => {
        const tc = b.start != null && Number.isFinite(b.start) ? `[${this.formatTimecode(b.start)}] ` : '';
        // Ярлык «Голос N» печатаем только когда говорящий действительно известен. Подписать
        // весь диалог как «Голос 1» значило бы выдать догадку за факт в документе, по которому
        // РОП разбирает работу менеджера.
        const who = b.speakerId >= 0 ? `Голос ${b.speakerId + 1}: ` : '';
        return `${tc}${who}${b.parts.join(' ')}`;
      })
      .join('\n\n');
  }

  /** Секунды → «mm:ss» (или «h:mm:ss» для записей длиннее часа). */
  private formatTimecode(seconds: number): string {
    const total = Math.max(0, Math.floor(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  async getForEntry(entryId: string, companyId?: string, ownerId?: string): Promise<EntryAudio | null> {
    await this.findEntryScoped(entryId, companyId, ownerId);
    return this.audioRepo.findOne({ where: { entryId } });
  }

  /**
   * Абсолютный путь к аудиофайлу записи после scope-проверки (company isolation + ownership).
   * Используется авторизованным эндпоинтом стрима — файл больше не раздаётся публичной статикой.
   */
  async resolveAudioFile(
    entryId: string,
    companyId?: string,
    ownerId?: string,
  ): Promise<{ absPath: string; size: number; fileName: string }> {
    await this.findEntryScoped(entryId, companyId, ownerId);
    const audio = await this.audioRepo.findOne({ where: { entryId } });
    if (!audio) throw new NotFoundException('Аудиозапись не найдена');
    const absPath = join(process.cwd(), audio.fileUrl.replace(/^\//, ''));
    if (!existsSync(absPath)) throw new NotFoundException('Файл записи не найден на сервере');
    return { absPath, size: audio.fileSize, fileName: audio.originalFileName };
  }

  /** Явная перезапись Entry.transcription готовым результатом (по кнопке с подтверждением). */
  async applyToEntry(entryId: string, companyId?: string, ownerId?: string): Promise<Entry> {
    const entry = await this.findEntryScoped(entryId, companyId, ownerId);
    const audio = await this.audioRepo.findOne({ where: { entryId } });
    if (!audio || audio.status !== 'done' || !audio.transcriptionResult) {
      throw new BadRequestException('Готовой транскрипции для этой записи нет');
    }
    entry.transcription = audio.transcriptionResult;
    const saved = await this.entryRepo.save(entry);
    await this.audioRepo.update(audio.id, { appliedAt: new Date() });
    return saved;
  }

  async removeAudio(entryId: string, companyId?: string, ownerId?: string): Promise<void> {
    await this.findEntryScoped(entryId, companyId, ownerId);
    const audio = await this.audioRepo.findOne({ where: { entryId } });
    if (!audio) return;
    if (['converting', 'queued', 'transcribing'].includes(audio.status)) {
      throw new BadRequestException('Файл сейчас обрабатывается — удалить можно после завершения');
    }
    await this.deleteAudioFile(audio);
    await this.audioRepo.remove(audio);
  }

  private async deleteAudioFile(audio: EntryAudio): Promise<void> {
    const abs = join(process.cwd(), audio.fileUrl.replace(/^\//, ''));
    await unlink(abs).catch(() => undefined);
  }

  // TR9: границы месяца по ЛОКАЛЬНОЙ дате компании, не по UTC сервера (тот же класс бага,
  // что CALC10 в премии РОПа) — иначе для Камчатки/Владивостока последние часы месяца
  // либо съедают, либо не съедают квоту в зависимости от того, кто там на UTC-часах.
  private async getMonthUsedSeconds(companyId: string, timezone?: string | null): Promise<number> {
    const { start } = currentMonthBoundsMs(timezone);
    const row = await this.usageRepo
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.seconds), 0)', 'total')
      .where('u.companyId = :companyId', { companyId })
      .andWhere('u.createdAt >= :start', { start })
      .getRawOne<{ total: string }>();
    return parseInt(row?.total ?? '0', 10);
  }

  async getMonthUsage(companyId: string): Promise<{ usedMinutes: number; limitMinutes: number | null; enabled: boolean }> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const usedSeconds = await this.getMonthUsedSeconds(companyId, company.timezone);
    return {
      usedMinutes: Math.round(usedSeconds / 60),
      limitMinutes: company.transcription?.monthlyMinutesLimit ?? null,
      enabled: company.transcription?.enabled ?? false,
    };
  }

  /** Recovery: вызывается cron'ом — разгребает очередь и возобновляет осиротевшие задачи. */
  async resumeStuck(): Promise<void> {
    const staleMs = 3 * 60_000;

    // Очередь: свободные слоты → запускаем задачи
    const inFlight = await this.audioRepo.count({ where: { status: 'transcribing' } });
    if (inFlight < MAX_PARALLEL_TASKS) {
      const queued = await this.audioRepo.find({
        where: { status: 'queued' },
        order: { createdAt: 'ASC' },
        take: MAX_PARALLEL_TASKS - inFlight,
      });
      for (const audio of queued) {
        const entry = await this.entryRepo.findOne({ where: { id: audio.entryId }, withDeleted: true });
        if (!entry) continue;
        const abs = join(process.cwd(), audio.fileUrl.replace(/^\//, ''));
        await this.createProviderTask(audio.id, entry.companyId, audio.durationSec, abs);
      }
    }

    // Поллинг прерван рестартом контейнера → возобновляем по providerTaskId
    const stuck = await this.audioRepo
      .createQueryBuilder('a')
      .where('a.status = :st', { st: 'transcribing' })
      .andWhere('a.providerTaskId IS NOT NULL')
      .andWhere('a.updatedAt < :before', { before: new Date(Date.now() - staleMs) })
      .getMany();
    for (const audio of stuck) {
      if (!this.active.has(audio.id)) {
        this.pollLoop(audio.id).catch(err => this.logger.error(`resume pollLoop ${audio.id}: ${(err as Error).message}`));
      }
    }

    // Конвертация, прерванная рестартом (исходник потерян) — честный отказ
    const deadConverting = await this.audioRepo
      .createQueryBuilder('a')
      .where('a.status IN (:...sts)', { sts: ['converting'] })
      .andWhere('a.updatedAt < :before', { before: new Date(Date.now() - 10 * 60_000) })
      .getMany();
    for (const audio of deadConverting) {
      await this.fail(audio.id, 'Обработка была прервана — загрузите файл ещё раз.');
    }
  }
}
