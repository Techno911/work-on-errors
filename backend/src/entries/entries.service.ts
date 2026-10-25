import { Injectable, NotFoundException,
  ConflictException, BadRequestException, ForbiddenException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Raw } from 'typeorm';
import * as fs from 'fs';
import { join, basename } from 'path';
import { Entry } from './entities/entry.entity';
import { EntryScreenshot } from './entities/entry-screenshot.entity';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { SprintStatus } from '../sprints/enums/sprint-status.enum';
import { UserRole } from '../users/enums/user-role.enum';
import { CreateEntryDto } from './dto/create-entry.dto';
import { UpdateEntryDto } from './dto/update-entry.dto';
import { ReviewEntryDto } from './dto/review-entry.dto';
import { ReviewConfirmDto } from './dto/review-confirm.dto';
import { sha256Text } from '../common/text-hash.util';
import { EntryStatus } from './enums/entry-status.enum';
import { EntryType } from './enums/entry-type.enum';
import { CompaniesService } from '../companies/companies.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { OcrService } from '../common/ocr.service';
import { CompanyEventsService } from '../company-events/company-events.service';
import { CompanyEventType } from '../company-events/entities/company-event.entity';
import { GamificationService } from '../gamification/gamification.service';
import { TranscriptionService } from '../transcription/transcription.service';
import { CrmIntegrationService, CrmHttp } from '../crm-integration/crm-integration.service';
import { CrmErrorCode } from '../crm-integration/errors/crm-error';
import { PlaybookDetectionService } from '../playbook/playbook-detection.service';
import { PLAYBOOK_CANDIDATE_WINDOW_DAYS } from '../playbook/playbook.util';
import { isValidImageFile } from '../common/file-sniff.util';

/** Повторяющаяся ошибка одного менеджера: сколько раз и по каким записям. */
export interface ManagerRepeat {
  tagId: string;
  tagName: string;
  count: number;
  lastEntries: { entryId: string; entryNumber: number; sprintId: string; entryDate: string }[];
}

@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name);

  constructor(
    @InjectRepository(Entry)
    private entriesRepository: Repository<Entry>,
    @InjectRepository(EntryScreenshot)
    private screenshotsRepository: Repository<EntryScreenshot>,
    @InjectRepository(ErrorTag)
    private errorTagsRepository: Repository<ErrorTag>,
    @InjectRepository(Sprint)
    private sprintsRepository: Repository<Sprint>,
    @Inject(forwardRef(() => CompaniesService))
    private companiesService: CompaniesService,
    private notificationsService: NotificationsService,
    private usersService: UsersService,
    private ocrService: OcrService,
    private gamificationService: GamificationService,
    private transcriptionService: TranscriptionService,
    private crmIntegrationService: CrmIntegrationService,
    private playbookDetectionService: PlaybookDetectionService,
    private companyEvents: CompanyEventsService,
  ) {}

  async findAll(sprintId?: string, managerId?: string, companyId?: string, status?: EntryStatus): Promise<Entry[]> {
    const where: Record<string, string> = {};
    if (sprintId) where.sprintId = sprintId;
    if (managerId) where.managerId = managerId;
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;

    // PERF10: без sprintId/managerId запрос не ограничен ни по времени, ни по составу —
    // растёт линейно с историей компании (обнаружено на 304КБ ответе). Явный status сужает
    // выборку по смыслу (напр. «ждут ревью»); без него — жёсткий потолок как последний рубеж.
    const take = !sprintId && !managerId ? 500 : undefined;

    const list = await this.entriesRepository.find({
      where,
      relations: ['manager', 'errorTags', 'screenshots', 'reviewer'],
      order: { entryNumber: 'ASC' },
      ...(take ? { take } : {}),
    });
    list.forEach(e => this.syncEntryHash(e));
    return list;
  }

  async findById(id: string, companyId?: string, ownerId?: string): Promise<Entry> {
    const entry = await this.entriesRepository.findOne({
      where: companyId ? { id, companyId } : { id },
      relations: ['manager', 'errorTags', 'screenshots', 'reviewer'],
    });
    if (!entry) throw new NotFoundException('Запись не найдена');
    // Same-company IDOR: менеджер видит только свои записи (самоанализ = признание своих ошибок).
    if (ownerId && entry.managerId !== ownerId) throw new ForbiddenException();
    this.syncEntryHash(entry);
    return entry;
  }

  /**
   * Допуск F1: хеш, отдаваемый UI, всегда соответствует реально отдаваемому
   * тексту. Если кеш устарел (строка изменена старым backend в окне выката),
   * в ответ идёт хеш актуального текста — пересчёт в памяти, без N+1 записей;
   * колонку чинит защищённый UPDATE в confirmReview (SET в том же клейме).
   */
  private syncEntryHash(entry: Entry): void {
    if (entry.reviewText && entry.reviewTextHash !== sha256Text(entry.reviewText)) {
      entry.reviewTextHash = sha256Text(entry.reviewText);
    }
  }

  /**
   * Повторяющиеся ошибки конкретного менеджера за окно методички.
   *
   * Запрос руководителя отдела продаж одного клиента (30.07.2026): «я дал обратную связь, а как я
   * теперь проверю, что её впитали, реально пошли и что-то изменили». Полный ответ это работа
   * ИИ по расшифровкам, но восемь десятых пользы даёт простой счёт: если тег «не выявил бюджет»
   * стоит у человека третий раз за шесть недель, обратная связь не применяется, и это видно
   * без всякой модели.
   *
   * Считаем по РАЗОБРАННЫМ записям (тег ставит руководитель при разборе) и по тому же окну,
   * что и методичка: два счёта одной сущности не должны жить по разным правилам.
   */
  async getManagerRepeats(entryId: string, companyId?: string): Promise<ManagerRepeat[]> {
    const entry = await this.findById(entryId, companyId);
    const since = new Date();
    since.setDate(since.getDate() - PLAYBOOK_CANDIDATE_WINDOW_DAYS);

    const past = await this.entriesRepository
      .createQueryBuilder('entry')
      .innerJoinAndSelect('entry.errorTags', 'tag')
      .where('entry.companyId = :companyId', { companyId: entry.companyId })
      .andWhere('entry.managerId = :managerId', { managerId: entry.managerId })
      .andWhere('entry.id != :selfId', { selfId: entry.id })
      .andWhere('entry.status = :status', { status: EntryStatus.REVIEWED })
      .andWhere('entry.deletedAt IS NULL')
      .andWhere('entry.reviewedAt >= :since', { since })
      .orderBy('entry.reviewedAt', 'DESC')
      .getMany();

    const byTag = new Map<string, ManagerRepeat>();
    for (const e of past) {
      for (const tag of e.errorTags ?? []) {
        if (!byTag.has(tag.id)) {
          byTag.set(tag.id, { tagId: tag.id, tagName: tag.name, count: 0, lastEntries: [] });
        }
        const row = byTag.get(tag.id)!;
        row.count++;
        // Три последних случая: руководителю нужен повод открыть их, а не полный список.
        if (row.lastEntries.length < 3) {
          row.lastEntries.push({
            entryId: e.id,
            entryNumber: e.entryNumber,
            sprintId: e.sprintId,
            entryDate: e.entryDate,
          });
        }
      }
    }

    return Array.from(byTag.values()).sort((a, b) => b.count - a.count);
  }

  async create(dto: CreateEntryDto): Promise<Entry> {
    // Мультитенантная изоляция: спринт и менеджер обязаны принадлежать той же компании,
    // иначе запись и профиль менеджера (ПДн: email/ФИО) утекают на чужую доску.
    const sprint = await this.sprintsRepository.findOne({ where: { id: dto.sprintId } });
    if (!sprint || sprint.companyId !== dto.companyId) {
      throw new ForbiddenException('Спринт не принадлежит этой компании');
    }
    if (sprint.status !== SprintStatus.ACTIVE) {
      throw new BadRequestException('Запись можно добавить только в активный спринт');
    }
    const manager = await this.usersService.findById(dto.managerId).catch(() => null);
    if (!manager || manager.companyId !== dto.companyId || manager.role !== UserRole.MANAGER) {
      throw new ForbiddenException('Менеджер не принадлежит этой компании');
    }

    const { stagedRecordingId, ...entryDto } = dto;
    const entry = this.entriesRepository.create(entryDto);
    let saved: Entry;
    try {
      saved = await this.entriesRepository.save(entry);
    } catch (err) {
      // Частичный уникальный индекс (companyId, crmCallId) ловит гонку двойного импорта
      if ((err as { code?: string }).code === '23505' && dto.crmCallId) {
        throw new ConflictException('Этот звонок уже добавлен в платформу');
      }
      // DI12: entryNumber считает клиент (count+1) — гонка (двойной клик, две вкладки)
      // ловится уникальным индексом (managerId,sprintId,type,entryNumber).
      if ((err as { code?: string }).code === '23505') {
        throw new ConflictException('Такая запись уже добавлена — обновите страницу и попробуйте снова');
      }
      throw err;
    }

    // Звонок из CRM: staged-запись уходит в обычный пайплайн транскрипции
    if (stagedRecordingId) {
      const staged = this.crmIntegrationService.takeStagedFile(stagedRecordingId);
      if (staged) {
        try {
          await this.transcriptionService.uploadAudio(
            saved.id,
            { path: staged.path, originalname: `Звонок из ${dto.crmProvider === 'amocrm' ? 'amoCRM' : 'Битрикс24'}.mp3`, size: staged.size },
            saved.companyId,
          );
        } catch (e) {
          this.logger.warn(`CRM-аудио для ${saved.id} не прикрепилось: ${(e as Error).message}`);
        }
      } else {
        // Staged-файл протух (чистка staging старше 24 ч): без него запись осталась бы
        // навсегда без аудио и без текста. Откатываем создание и просим выбрать звонок заново.
        this.logger.warn(`Staged-файл ${stagedRecordingId} устарел — откатываем запись ${saved.id}`);
        await this.entriesRepository.delete(saved.id);
        throw new CrmHttp(CrmErrorCode.STAGED_EXPIRED);
      }
    }
    return saved;
  }

  async update(id: string, dto: UpdateEntryDto, companyId?: string, ownerId?: string): Promise<Entry> {
    const entry = await this.findById(id, companyId);
    if (ownerId && entry.managerId !== ownerId) throw new ForbiddenException();
    // Аудит-трейл: после отправки на ревью содержание записи (самоанализ, транскрипция, дата)
    // заморожено — иначе менеджер молча переписывает разговор уже под написанное РОПом ревью.
    if (entry.status !== EntryStatus.DRAFT) {
      throw new BadRequestException('Запись уже отправлена на ревью — редактирование недоступно');
    }
    Object.assign(entry, dto);
    return this.entriesRepository.save(entry);
  }

  async submit(id: string, companyId?: string, ownerId?: string): Promise<Entry> {
    const entry = await this.findById(id, companyId);
    if (ownerId && entry.managerId !== ownerId) throw new ForbiddenException();

    // State machine guard: only draft entries can be submitted
    if (entry.status !== EntryStatus.DRAFT) {
      throw new BadRequestException('Запись уже отправлена или проверена');
    }

    // Звонок без текста: пробуем подхватить готовую транскрипцию, иначе честно блокируем
    if (entry.type === EntryType.CALL && !(entry.transcription ?? '').trim()) {
      const audio = await this.transcriptionService.getForEntry(entry.id, entry.companyId);
      if (audio && ['converting', 'queued', 'transcribing'].includes(audio.status)) {
        throw new BadRequestException('Транскрипция ещё готовится — дождитесь завершения или вставьте текст вручную');
      }
      if (audio?.status === 'done' && audio.transcriptionResult) {
        entry.transcription = audio.transcriptionResult;
      } else {
        throw new BadRequestException('Добавьте текст разговора или дождитесь транскрипции аудиофайла');
      }
    }

    // Переписка без содержимого: раньше форма гарантировала скриншот при создании, и проверки
    // здесь не было вовсе. С 05.08.2026 переписку можно вставить текстом (просьба клиента клиента),
    // значит отправить пустую запись стало физически возможно — блокируем явно.
    if (entry.type === EntryType.CHAT) {
      const shots = await this.screenshotsRepository.count({ where: { entryId: entry.id } });
      if (shots === 0 && !(entry.transcription ?? '').trim()) {
        throw new BadRequestException('Добавьте текст переписки или хотя бы один скриншот');
      }
    }

    // Получаем настройки компании
    const settings = await this.companiesService.getSettings(entry.companyId);

    const errors: string[] = [];

    const correctLen = entry.selfReviewCorrect?.trim().length ?? 0;
    if (correctLen < settings.minSelfReviewCorrectChars) {
      errors.push(`«Что сделано правильно» — минимум ${settings.minSelfReviewCorrectChars} символов (сейчас ${correctLen})`);
    }

    const improveLen = entry.selfReviewImprove?.trim().length ?? 0;
    if (improveLen < settings.minSelfReviewImproveChars) {
      errors.push(`«Что можно улучшить» — минимум ${settings.minSelfReviewImproveChars} символов (сейчас ${improveLen})`);
    }

    if (settings.minSelfReviewSuggestionsChars > 0) {
      const suggestionsLen = entry.selfReviewSuggestions?.trim().length ?? 0;
      if (suggestionsLen < settings.minSelfReviewSuggestionsChars) {
        errors.push(`«Конкретные предложения» — минимум ${settings.minSelfReviewSuggestionsChars} символов (сейчас ${suggestionsLen})`);
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Самоанализ не соответствует минимальным требованиям',
        errors,
      });
    }

    entry.status = EntryStatus.SUBMITTED;
    // Норматив руководителя начинается здесь, а не при создании черновика.
    entry.submittedAt = new Date();
    // Атомарный клейм перехода draft→submitted ПЕРЕД сохранением (REL2): два одновременных
    // клика «Отправить» иначе оба проходят проверку статуса выше (читали draft ДО записи друг
    // друга) и оба начисляют XP/шлют уведомления. affected=0 = кто-то уже выиграл гонку.
    const claim = await this.entriesRepository.update(
      { id: entry.id, status: EntryStatus.DRAFT },
      { status: EntryStatus.SUBMITTED, transcription: entry.transcription, submittedAt: entry.submittedAt },
    );
    if (claim.affected === 0) {
      throw new BadRequestException('Запись уже отправлена или проверена');
    }
    const saved = await this.entriesRepository.save(entry);

    // Первая сданная запись компании: событие для журнала. Именно она, а не вход, закрывает
    // подключение человека — вход стоит тридцать секунд и ничего не доказывает, а сданная
    // запись означает, что человек показал свой звонок руководителю (разбор, часть 3.4).
    try {
      const companySubmitted = await this.entriesRepository.count({
        where: [
          { companyId: entry.companyId, status: EntryStatus.SUBMITTED },
          { companyId: entry.companyId, status: EntryStatus.REVIEWED },
        ],
      });
      if (companySubmitted === 1) {
        await this.companyEvents.log({
          companyId: entry.companyId,
          type: CompanyEventType.FIRST_ENTRY,
          title: 'Первая запись сдана',
          details: `${entry.manager?.fullName ?? 'Менеджер'} отправил первую запись на разбор. Петля пошла.`,
          actorUserId: entry.managerId,
          actorLabel: entry.manager?.fullName ?? null,
          payload: { entryId: entry.id },
        });
      }
    } catch (e) {
      this.logger.warn(`событие первой записи не записано: ${(e as Error).message}`);
    }

    // Gamification: award XP and update streak for submitted entry
    try {
      const submitCount = await this.entriesRepository.count({ where: { managerId: entry.managerId, status: EntryStatus.SUBMITTED } });
      const isFirstEver = submitCount === 1;
      await this.gamificationService.onEntrySubmitted(entry.managerId, entry.id, isFirstEver, false);

      // Бонус за самоанализ ЗАМЕТНО подробнее минимума компании, не хардкод (GAM3): раньше
      // фиксированные 500 символов не учитывали company.minSelfReview*Chars — при высоких
      // нормативах бонус выдавался почти всегда, при низких — почти никогда.
      const selfReviewLen = (entry.selfReviewCorrect?.length ?? 0) + (entry.selfReviewImprove?.length ?? 0) + (entry.selfReviewSuggestions?.length ?? 0);
      const selfReviewMinSum = settings.minSelfReviewCorrectChars + settings.minSelfReviewImproveChars + settings.minSelfReviewSuggestionsChars;
      const selfReviewBonusThreshold = Math.max(50, Math.round(selfReviewMinSum * 1.5));
      if (selfReviewLen > selfReviewBonusThreshold) {
        await this.gamificationService.onSelfReviewComplete(entry.managerId, entry.id);
      }
    } catch (e) {
      // Gamification errors should not block the main flow
    }

    // Notify all reviewers in the company
    try {
      const allUsers = await this.usersService.findAll(entry.companyId);
      const reviewers = allUsers.filter(u => u.role === 'reviewer');
      const managerName = entry.manager?.fullName ?? 'Менеджер';

      for (const reviewer of reviewers) {
        await this.notificationsService.create({
          userId: reviewer.id,
          type: NotificationType.ENTRY_SUBMITTED,
          title: 'Новая запись на проверку',
          message: `${managerName} отправил(а) запись #${entry.entryNumber} на проверку`,
          relatedId: entry.id,
          linkUrl: `/sprint/${entry.sprintId}?entryId=${entry.id}`,
        });
      }
    } catch (e) {
      // Notification errors should not block the main flow
    }

    return saved;
  }

  async review(id: string, dto: ReviewEntryDto, reviewerId: string, companyId?: string): Promise<Entry> {
    const entry = await this.findById(id, companyId);

    // Разбор уточняют уже после сохранения: РОП перечитывает запись, дописывает вывод,
    // доставляет теги. Форма это всегда позволяла, а сервис запрещал, и правка падала 400
    // (поймано у живого клиента 29.07.2026). Правка готового разбора — НЕ повторный разбор:
    // она не начисляет XP заново, не сдвигает reviewedAt и не меняет авторство, потому что
    // от них считаются норматив разбора и премия РОПа.
    const isEdit = entry.status === EntryStatus.REVIEWED;

    // State machine guard: только отправленную запись можно разобрать впервые
    if (entry.status !== EntryStatus.SUBMITTED && !isEdit) {
      throw new BadRequestException('Ревью можно написать только для отправленной записи');
    }

    // Получаем настройки компании
    const settings = await this.companiesService.getSettings(entry.companyId);

    const reviewLen = dto.reviewText?.trim().length ?? 0;
    if (reviewLen < settings.minReviewChars) {
      throw new BadRequestException(
        `Ревью должно содержать минимум ${settings.minReviewChars} символов (сейчас ${reviewLen})`
      );
    }

    entry.reviewText = dto.reviewText;
    // Версия текста пишется одной записью с самим текстом: правка меняет hash
    // атомарно, менеджер видит «РОП дополнил разбор после подтверждения».
    entry.reviewTextHash = sha256Text(dto.reviewText);
    // Факты подтверждения менеджера из снимка НЕ сохраняем: загруженные при findById
    // значения могли устареть, если подтверждение прошло между чтением и save
    // (гонка confirm→edit). save() пропускает undefined — поля не затираются.
    delete (entry as Partial<Entry>).reviewConfirmedHash;
    delete (entry as Partial<Entry>).reviewConfirmedAt;
    delete (entry as Partial<Entry>).reviewRereadAt;
    if (!isEdit) {
      entry.reviewerId = reviewerId;
      entry.reviewedAt = new Date();
      entry.status = EntryStatus.REVIEWED;
    }

    if (dto.tagIds && dto.tagIds.length > 0) {
      // Security: filter tags by companyId to prevent cross-company tag injection
      const tags = await this.errorTagsRepository.find({
        where: { id: In(dto.tagIds), companyId: entry.companyId },
      });
      entry.errorTags = tags;
    } else {
      entry.errorTags = [];
    }

    // Атомарный клейм перехода submitted→reviewed ПЕРЕД сохранением (REL2): та же гонка,
    // что и в submit() — два одновременных ревью иначе оба проходят проверку выше и оба
    // начисляют XP менеджеру и шлют уведомления. Правка готового разбора перехода статуса
    // не делает, клеймить там нечего.
    if (!isEdit) {
      const claim = await this.entriesRepository.update(
        { id: entry.id, status: EntryStatus.SUBMITTED },
        { status: EntryStatus.REVIEWED },
      );
      if (claim.affected === 0) {
        throw new BadRequestException('Ревью можно написать только для отправленной записи');
      }
    }
    const saved = await this.entriesRepository.save(entry);

    // Первый разбор РОПа в компании: петля прокрутилась целиком, и это главный факт запуска.
    if (!isEdit) {
      try {
        const reviewedCount = await this.entriesRepository.count({
          where: { companyId: entry.companyId, status: EntryStatus.REVIEWED },
        });
        if (reviewedCount === 1) {
          await this.companyEvents.log({
            companyId: entry.companyId,
            type: CompanyEventType.FIRST_REVIEW,
            title: 'Первый разбор РОПа',
            details: 'Петля прокрутилась целиком: запись сдана, разобрана, менеджер получил обратную связь.',
            actorUserId: entry.reviewerId,
            payload: { entryId: entry.id },
          });
        }
      } catch (e) {
        this.logger.warn(`событие первого разбора не записано: ${(e as Error).message}`);
      }
    }

    // Методичка сама ищет повторы — по тегам И по смыслу текста разбора (28.07.2026: тег
    // ненадёжен, если РОП его не проставит, страховкой служит семантическое сравнение).
    // Решение подтвердить/отклонить не отдаётся ему галочкой в форме.
    try {
      await this.playbookDetectionService.checkEntry(saved);
    } catch (e) {
      this.logger.warn(`Проверка повторов методички не выполнена: ${(e as Error).message}`);
    }

    // Gamification: award XP to manager for received review.
    // Только за первый разбор: awardXp не дедуплицирует по записи, и без этого условия
    // РОП накручивал бы менеджеру опыт каждым пересохранением того же разбора.
    if (!isEdit) {
      try {
        const hasErrorTags = (dto.tagIds?.length ?? 0) > 0;
        await this.gamificationService.onReviewReceived(entry.managerId, entry.id, hasErrorTags);
      } catch (e) {
        // Gamification errors should not block the main flow
      }
    }

    // Notify the manager who owns the entry + auto-clear reviewer's entry_submitted notifications.
    // При правке разбор у менеджера меняется, и он должен об этом узнать: текст другой,
    // тип уведомления тот же (новое значение enum потребовало бы миграции ALTER TYPE).
    try {
      await this.notificationsService.create({
        userId: entry.managerId,
        type: NotificationType.ENTRY_REVIEWED,
        title: isEdit ? 'Разбор дополнен' : 'Ваша запись проверена',
        message: isEdit
          ? `Руководитель уточнил разбор записи #${entry.entryNumber}`
          : `Запись #${entry.entryNumber} получила ревью`,
        relatedId: entry.id,
        linkUrl: `/sprint/${entry.sprintId}?entryId=${entry.id}`,
      });
      // Автоматически снять "Новая запись на проверку" у рецензента — задача выполнена
      if (!isEdit) {
        await this.notificationsService.markReadByRelatedId(reviewerId, entry.id);
      }
    } catch (e) {
      // Notification errors should not block the main flow
    }

    return saved;
  }

  async setTags(id: string, tagIds: string[], companyId?: string): Promise<Entry> {
    const entry = await this.findById(id, companyId);
    // DI11: теги ошибок — результат РЕВЬЮ, не самоанализа. На черновике (менеджер ещё
    // редактирует и может удалить запись) тегов быть не может — раньше это не проверялось.
    if (entry.status === EntryStatus.DRAFT) {
      throw new BadRequestException('Запись ещё не отправлена на ревью — теги недоступны');
    }
    // Security: filter tags by companyId to prevent cross-company tag injection
    const tags = tagIds.length > 0
      ? await this.errorTagsRepository.find({ where: { id: In(tagIds), companyId: entry.companyId } })
      : [];
    entry.errorTags = tags;
    return this.entriesRepository.save(entry);
  }

  async remove(id: string, companyId: string | undefined, actorRole: UserRole): Promise<void> {
    const entry = await this.findById(id, companyId);
    // РОПу удаление нужно только как исправление ошибки ДО отправки записи. После сдачи
    // запись участвует в нормативе, премии и истории обратной связи, поэтому исчезать не может.
    if (actorRole === UserRole.REVIEWER && entry.status !== EntryStatus.DRAFT) {
      throw new BadRequestException('РОП может удалить только черновик менеджера');
    }
    await this.entriesRepository.softRemove(entry);
  }

  async addScreenshots(
    entryId: string,
    files: Array<{ originalname: string; filename: string; size: number }>,
    companyId?: string,
    ownerId?: string,
  ): Promise<EntryScreenshot[]> {
    // findById уже несёт same-company + same-manager проверку (IDOR: менеджер мог
    // загружать/удалять скриншоты чужой записи — companyId один на всех менеджеров компании).
    await this.findById(entryId, companyId, ownerId);
    const existingCount = await this.screenshotsRepository.count({ where: { entryId } });
    const screenshots = files.map((file, index) =>
      this.screenshotsRepository.create({
        entryId,
        fileUrl: `/uploads/screenshots/${file.filename}`,
        fileName: file.originalname,
        fileSize: file.size,
        sortOrder: existingCount + index,
      }),
    );
    // AUDIT-0710 (L3): fileFilter верил метке Content-Type от браузера. Сверяем реальную
    // сигнатуру сохранённого файла; не-картинку удаляем с диска и отклоняем всю пачку.
    for (const file of files) {
      const abs = join(process.cwd(), 'uploads', 'screenshots', file.filename);
      if (!isValidImageFile(abs)) {
        try { fs.unlinkSync(abs); } catch { /* файл уже отсутствует — не критично */ }
        throw new BadRequestException('Файл не является изображением (PNG, JPEG или WebP)');
      }
    }

    const saved = await this.screenshotsRepository.save(screenshots);

    // OCR в фоне — не блокируем ответ клиенту
    for (let i = 0; i < saved.length; i++) {
      const screenshotId = saved[i].id;
      const filePath = join(process.cwd(), 'uploads', 'screenshots', files[i].filename);
      this.processOcr(screenshotId, filePath).catch(err =>
        this.logger.error(`OCR background error for ${screenshotId}: ${err.message}`),
      );
    }

    return saved;
  }

  private async processOcr(screenshotId: string, filePath: string): Promise<void> {
    const text = await this.ocrService.recognizeText(filePath);
    // null = распознавание не выполнилось: помечаем скриншот, чтобы фронт мог показать
    // «текст не распознан» вместо молчаливой пустоты (AUDIT-0710, M2).
    if (text === null) {
      await this.screenshotsRepository.update(screenshotId, { ocrFailed: true });
    } else if (text) {
      await this.screenshotsRepository.update(screenshotId, { extractedText: text });
    }
  }

  async removeScreenshot(entryId: string, screenshotId: string, companyId?: string, ownerId?: string): Promise<void> {
    await this.findById(entryId, companyId, ownerId);
    const screenshot = await this.screenshotsRepository.findOne({
      where: { id: screenshotId, entryId },
    });
    if (!screenshot) throw new NotFoundException('Скриншот не найден');
    // Delete physical file
    try {
      const filename = basename(screenshot.fileUrl);
      const filePath = join(process.cwd(), 'uploads', 'screenshots', filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // Non-critical: DB record is still removed even if file deletion fails
    }
    await this.screenshotsRepository.remove(screenshot);
  }

  /**
   * Абсолютный путь к скриншоту переписки (ПД клиента) после scope-проверки
   * (company isolation + manager ownership). Заменяет публичную раздачу /uploads.
   */
  async resolveScreenshotFile(
    entryId: string,
    screenshotId: string,
    companyId?: string,
    ownerId?: string,
  ): Promise<{ absPath: string; fileName: string }> {
    const entry = await this.entriesRepository.findOne({
      where: companyId ? { id: entryId, companyId } : { id: entryId },
    });
    if (!entry) throw new NotFoundException('Запись не найдена');
    if (ownerId && entry.managerId !== ownerId) throw new ForbiddenException();
    const screenshot = await this.screenshotsRepository.findOne({
      where: { id: screenshotId, entryId },
    });
    if (!screenshot) throw new NotFoundException('Скриншот не найден');
    const filename = basename(screenshot.fileUrl);
    const absPath = join(process.cwd(), 'uploads', 'screenshots', filename);
    if (!fs.existsSync(absPath)) throw new NotFoundException('Файл скриншота не найден на сервере');
    return { absPath, fileName: screenshot.fileName };
  }

  /**
   * Личное подтверждение чтения разбора менеджером (review-reread-confirm).
   * Автор — серверный пользователь (контроллер уже отсёк «Глазами» и неменеджера);
   * запись — только собственная, в своей компании, статус reviewed, reviewText непуст.
   * Атомарный UPDATE со всей строкой WHERE: гонка правки РОПом отклоняет устаревший
   * expectedHash (правка меняет reviewTextHash одной записью с текстом).
   */
  async confirmReview(
    entryId: string,
    dto: ReviewConfirmDto,
    user: { id: string; companyId: string | null },
  ): Promise<Pick<Entry, 'reviewConfirmedAt' | 'reviewRereadAt' | 'reviewConfirmedHash' | 'reviewTextHash'>> {
    const entry = await this.findById(entryId, user.companyId ?? undefined);
    if (entry.managerId !== user.id) {
      throw new ForbiddenException('Отметка ставится только у своего разбора');
    }
    if (entry.status !== EntryStatus.REVIEWED || !entry.reviewText) {
      throw new BadRequestException('Отметка возможна только у разобранной записи');
    }

    // Корректность по ФАКТИЧЕСКОМУ тексту (допуск F1): NULL или устаревший
    // НЕNULL-кеш (строка изменена старым backend в окне выката) лечится в том же
    // защищённом UPDATE — отдельного «проставить хеш по id+NULL» нет, иначе
    // конкурентная правка получала бы чужую версию. Ожидаемый хеш клиенту
    // сверяем с actual, а не с кешем.
    const hashActual = sha256Text(entry.reviewText);
    if (dto.expectedHash !== hashActual) {
      throw new ConflictException('Разбор дополнен — перечитайте актуальный текст');
    }

    // Один защищённый UPDATE: предикат по тексту записи + CAS по наблюдаемому
    // клиентом reread (технический повтор ответа не печатает новое чтение).
    // Точность хранения — миллисекунды: клиент держит значение через ISO-строку
    // Date (ms), микросекунды PG now() делали бы каждый повтор вечным no-op.
    const claim = await this.entriesRepository
      .createQueryBuilder()
      .update(Entry)
      .set({
        reviewConfirmedHash: dto.expectedHash,
        reviewConfirmedAt: () => 'COALESCE("reviewConfirmedAt", :cat)',
        reviewRereadAt: () => 'CAST(:cat AS timestamptz(3))',
        reviewTextHash: hashActual,
      })
      .setParameter('cat', new Date())
      .where(`id = :id AND "managerId" = :uid AND "companyId" = :cid AND status = 'reviewed'
              AND "deletedAt" IS NULL
              AND "reviewText" IS NOT DISTINCT FROM :textAtRead
              AND "reviewRereadAt" IS NOT DISTINCT FROM CAST(:lastSeen AS timestamptz)`, {
        id: entry.id,
        uid: user.id,
        cid: entry.companyId,
        textAtRead: entry.reviewText,
        lastSeen: dto.lastSeenRereadAt ?? null,
      })
      .returning(['reviewConfirmedAt', 'reviewRereadAt', 'reviewConfirmedHash', 'reviewTextHash'])
      .execute();

    if (claim.affected && claim.raw?.length) {
      return claim.raw[0];
    }

    // affected 0: технический повтор (CAS расхождение) ИЛИ гонка изменений.
    // Перечитываем и отдаём авторитетное состояние только если оно по-прежнему
    // валидно для этого действия — отказ проверок не превращаем в «уже есть».
    const cur = await this.findById(entryId, user.companyId ?? undefined);
    if (cur.managerId !== user.id) {
      throw new ForbiddenException('Отметка ставится только у своего разбора');
    }
    if (cur.status !== EntryStatus.REVIEWED || !cur.reviewText) {
      throw new BadRequestException('Отметка возможна только у разобранной записи');
    }
    if (sha256Text(cur.reviewText) !== dto.expectedHash) {
      throw new ConflictException('Разбор дополнен — перечитайте актуальный текст');
    }
    return {
      reviewConfirmedAt: cur.reviewConfirmedAt,
      reviewRereadAt: cur.reviewRereadAt,
      reviewConfirmedHash: cur.reviewConfirmedHash,
      reviewTextHash: cur.reviewTextHash,
    };
  }

  async getRecentReviews(
    managerId: string,
    limit: number,
    companyId?: string,
    opts?: { offset?: number; orderBy?: 'reviewedAt'; requireText?: boolean },
  ): Promise<Entry[]> {
    const where: Record<string, unknown> = companyId
      ? { managerId, companyId, status: EntryStatus.REVIEWED }
      : { managerId, status: EntryStatus.REVIEWED };
    if (opts?.requireText) {
      // Непустой текст по существу: NULL и разбор из одних whitespace-символов
      // (пробелы, табы, переносы — POSIX [[:space:]]) в подборке не нужны.
      where.reviewText = Raw(alias => `${alias} IS NOT NULL AND ${alias} !~ '^[[:space:]]*$'`);
    }
    const list = await this.entriesRepository.find({
      where: where as never,
      relations: ['errorTags'],
      // Стабильный порядок подборки: reviewedAt + id для детерминированного tie;
      // без orderBy — прежнее поведение дашборда (updatedAt DESC).
      order: opts?.orderBy === 'reviewedAt'
        ? { reviewedAt: 'DESC', id: 'DESC' }
        : { updatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 50),
      skip: opts?.offset ?? 0,
    });
    list.forEach(e => this.syncEntryHash(e));
    return list;
  }
}
