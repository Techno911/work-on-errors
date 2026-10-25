import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Entry } from '../entries/entities/entry.entity';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { ErrorTag } from '../error-tags/entities/error-tag.entity';
import { PlaybookCard, PlaybookCardStatus, PlaybookEvidenceEntry } from './entities/playbook-card.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';
import { OllamaService } from '../llm/ollama.service';
import { cosineSimilarity } from '../llm/llm.util';
import { redactPii } from '../common/pii-redact.util';
import {
  PLAYBOOK_CANDIDATE_WINDOW_DAYS, PLAYBOOK_CANDIDATE_THRESHOLD, PLAYBOOK_REOPEN_DELTA,
  PLAYBOOK_SEMANTIC_THRESHOLD,
  computeTrend, shouldCreateCandidate, shouldReopenAfterDismissal, humanizeTagName, truncateQuote,
  findSemanticNeighbors, overlapsKnownCluster, stripReviewBoilerplate,
} from './playbook.util';

interface Signal {
  count: number;
  trend: PlaybookCard['trend'];
  evidence: PlaybookEvidenceEntry[];
}

/**
 * Находит повторы САМА, без ручной галочки в разборе (решение владельца продукта: «нам нужно
 * сами находить повторения и показывать эту кнопку именно тогда, когда система увидит
 * повторения и покажет это с доказательством» — РОП мог не заметить, что стоит отметить разбор
 * как повторяющийся). Вызывается после КАЖДОГО ревью (entries.service.ts → review()) точкой
 * входа checkEntry() — двумя независимыми слоями:
 *
 * 1. Тег-детекция (как раньше): считает повтор по ПРИМЕНЁННЫМ тегам.
 * 2. Семантическая детекция (28.07.2026, страховка от РОПа): даже если РОП тег не поставил,
 *    текст разбора сравнивается по смыслу (эмбеддинг bge-m3 через свою Ollama, 0 ₽ за запрос)
 *    с прошлыми разборами компании за то же окно. Набрался кластер похожих — поднимаем
 *    кандидата так же, как при повторе тега, но detectionSource='semantic'.
 *
 * У каждого нового кандидата (любым путём) фоново (не блокируя ответ API) генерируется
 * черновик правила «как делаем у нас» из его же evidence-цитат — Release 2 плана «Методичка».
 */
@Injectable()
export class PlaybookDetectionService {
  private readonly logger = new Logger(PlaybookDetectionService.name);

  constructor(
    @InjectRepository(Entry)
    private readonly entryRepo: Repository<Entry>,
    @InjectRepository(ErrorTag)
    private readonly tagRepo: Repository<ErrorTag>,
    @InjectRepository(PlaybookCard)
    private readonly cardRepo: Repository<PlaybookCard>,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
    private readonly ollama: OllamaService,
  ) {}

  /** Единая точка входа из EntriesService.review() — вызывается на КАЖДОМ разборе. */
  async checkEntry(entry: Entry): Promise<void> {
    await this.storeEmbedding(entry);

    const tagIds = (entry.errorTags ?? []).map((t) => t.id);
    if (tagIds.length) {
      for (const tagId of tagIds) {
        try {
          await this.checkOneTag(entry.companyId, tagId);
        } catch (e) {
          this.logger.warn(`Проверка повтора по тегу ${tagId} не выполнена: ${(e as Error).message}`);
        }
      }
    }

    try {
      await this.checkSemantic(entry);
    } catch (e) {
      this.logger.warn(`Семантическая проверка повтора для разбора ${entry.id} не выполнена: ${(e as Error).message}`);
    }
  }

  /** Считает и сохраняет эмбеддинг текста разбора — база для семантической детекции. */
  private async storeEmbedding(entry: Entry): Promise<void> {
    if (!entry.reviewText?.trim()) return;
    const vector = await this.ollama.embed(stripReviewBoilerplate(entry.reviewText));
    if (!vector) return; // Ollama недоступна — семантический слой в этот раз просто не сработает
    entry.reviewEmbedding = vector;
    await this.entryRepo.update({ id: entry.id }, { reviewEmbedding: vector });
  }

  // ───────────────────────── Тег-детекция ─────────────────────────

  private async checkOneTag(companyId: string, tagId: string): Promise<void> {
    const existing = await this.cardRepo.findOne({ where: { companyId, errorTagId: tagId } });

    // Живая карточка (кандидат или уже в методичке): просто освежаем счётчик и тренд,
    // без нового уведомления — иначе РОП получал бы письмо на каждый разбор с тем же тегом.
    if (existing && existing.status !== PlaybookCardStatus.DISMISSED) {
      const signal = await this.computeSignal(companyId, tagId);
      existing.occurrenceCount = signal.count;
      existing.trend = signal.trend;
      existing.lastOccurrenceAt = new Date();
      existing.autoResolvedHint = false; // новый случай подтвердил, что ошибка ещё живая
      if (existing.status === PlaybookCardStatus.CANDIDATE) {
        existing.evidence = signal.evidence;
      }
      await this.cardRepo.save(existing);
      return;
    }

    const signal = await this.computeSignal(companyId, tagId);

    if (existing && existing.status === PlaybookCardStatus.DISMISSED) {
      if (!shouldReopenAfterDismissal(signal.count, existing.occurrenceCountAtDismissal, PLAYBOOK_REOPEN_DELTA)) {
        return; // РОП уже сказал «нет» на это, новых поводов пересмотреть решение пока мало
      }
      existing.status = PlaybookCardStatus.CANDIDATE;
      existing.occurrenceCount = signal.count;
      existing.trend = signal.trend;
      existing.evidence = signal.evidence;
      existing.lastOccurrenceAt = new Date();
      existing.autoResolvedHint = false;
      existing.dismissedAt = null;
      existing.dismissedBy = null;
      existing.dismissedReason = null;
      existing.occurrenceCountAtDismissal = null;
      await this.cardRepo.save(existing);
      await this.notifyCandidate(companyId, existing);
      this.generateDraftAsync(existing.id, signal.evidence.map((e) => e.reviewSnippet), false);
      return;
    }

    // Совсем новый тег в поле зрения методички
    if (!shouldCreateCandidate(signal.count, PLAYBOOK_CANDIDATE_THRESHOLD)) return;

    const tag = await this.tagRepo.findOne({ where: { id: tagId } });
    const card = this.cardRepo.create({
      companyId,
      errorTagId: tagId,
      title: humanizeTagName(tag?.name ?? ''),
      status: PlaybookCardStatus.CANDIDATE,
      occurrenceCount: signal.count,
      trend: signal.trend,
      evidence: signal.evidence,
      examples: [],
      detectionSource: 'tag',
      lastOccurrenceAt: new Date(),
    });
    const saved = await this.cardRepo.save(card);
    await this.notifyCandidate(companyId, saved);
    this.generateDraftAsync(saved.id, signal.evidence.map((e) => e.reviewSnippet), false);
  }

  /** Сигнал по тегу: сколько раз встречался за окно, куда движется, и три свежих доказательства. */
  private async computeSignal(companyId: string, tagId: string): Promise<Signal> {
    const since = new Date();
    since.setDate(since.getDate() - PLAYBOOK_CANDIDATE_WINDOW_DAYS);

    const entries = await this.entryRepo
      .createQueryBuilder('entry')
      .innerJoin('entry.errorTags', 'tag', 'tag.id = :tagId', { tagId })
      .leftJoinAndSelect('entry.manager', 'manager')
      .where('entry.companyId = :companyId', { companyId })
      .andWhere('entry.status = :status', { status: EntryStatus.REVIEWED })
      .andWhere('entry.deletedAt IS NULL')
      .andWhere('entry.reviewedAt >= :since', { since })
      .orderBy('entry.reviewedAt', 'DESC')
      .getMany();

    const evidence: PlaybookEvidenceEntry[] = entries.slice(0, 3).map((e) => ({
      entryId: e.id,
      entryNumber: e.entryNumber,
      sprintId: e.sprintId,
      managerName: e.manager?.fullName ?? 'Менеджер',
      entryDate: e.entryDate,
      // Доказательство — то, что сам РОП написал в разборе, не домысленная цитата разговора,
      // но перед показом (и перед возможной сборкой в клиентский документ) — обезличено.
      reviewSnippet: redactPii(truncateQuote(e.reviewText ?? '', 220)),
    }));

    return {
      count: entries.length,
      trend: computeTrend(entries.map((e) => e.reviewedAt!).filter(Boolean), PLAYBOOK_CANDIDATE_WINDOW_DAYS),
      evidence,
    };
  }

  // ───────────────────────── Семантическая детекция (страховка без тега) ─────────────────────────

  private async checkSemantic(entry: Entry): Promise<void> {
    if (!entry.reviewEmbedding) return;

    const since = new Date();
    since.setDate(since.getDate() - PLAYBOOK_CANDIDATE_WINDOW_DAYS);

    const pool = await this.entryRepo
      .createQueryBuilder('entry')
      .leftJoinAndSelect('entry.manager', 'manager')
      .where('entry.companyId = :companyId', { companyId: entry.companyId })
      .andWhere('entry.status = :status', { status: EntryStatus.REVIEWED })
      .andWhere('entry.deletedAt IS NULL')
      .andWhere('entry.reviewedAt >= :since', { since })
      .andWhere('entry.id != :id', { id: entry.id })
      .andWhere('entry.reviewEmbedding IS NOT NULL')
      .orderBy('entry.reviewedAt', 'DESC')
      .getMany();

    if (!pool.length) return;

    const neighborIds = findSemanticNeighbors(
      entry.reviewEmbedding,
      pool.map((p) => ({ entryId: p.id, embedding: p.reviewEmbedding! })),
      PLAYBOOK_SEMANTIC_THRESHOLD,
      cosineSimilarity,
    );
    const clusterIds = [entry.id, ...neighborIds];
    if (!shouldCreateCandidate(clusterIds.length, PLAYBOOK_CANDIDATE_THRESHOLD)) return;

    const clusterEntries = [entry, ...pool.filter((p) => neighborIds.includes(p.id))]
      .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0));

    // Живая семантическая карточка уже держит по большей части этот же кластер разборов —
    // не плодим второго кандидата на ту же находку, освежаем существующую.
    const liveSemanticCards = await this.cardRepo.find({
      where: { companyId: entry.companyId, detectionSource: 'semantic' },
    });
    const known = liveSemanticCards.find(
      (c) => c.status !== PlaybookCardStatus.DISMISSED && overlapsKnownCluster(clusterIds, c.sourceEntryIds),
    );

    const evidence: PlaybookEvidenceEntry[] = clusterEntries.slice(0, 3).map((e) => ({
      entryId: e.id,
      entryNumber: e.entryNumber,
      sprintId: e.sprintId,
      managerName: e.manager?.fullName ?? 'Менеджер',
      entryDate: e.entryDate,
      reviewSnippet: redactPii(truncateQuote(e.reviewText ?? '', 220)),
    }));
    const trend = computeTrend(clusterEntries.map((e) => e.reviewedAt!).filter(Boolean), PLAYBOOK_CANDIDATE_WINDOW_DAYS);

    if (known) {
      known.occurrenceCount = clusterIds.length;
      known.trend = trend;
      known.lastOccurrenceAt = new Date();
      known.autoResolvedHint = false;
      known.sourceEntryIds = Array.from(new Set([...known.sourceEntryIds, ...clusterIds]));
      if (known.status === PlaybookCardStatus.CANDIDATE) known.evidence = evidence;
      await this.cardRepo.save(known);
      return;
    }

    // Отклонённая ранее карточка на этот же кластер — тот же порог переоткрытия, что у тега.
    const dismissedMatch = liveSemanticCards.find(
      (c) => c.status === PlaybookCardStatus.DISMISSED && overlapsKnownCluster(clusterIds, c.sourceEntryIds),
    );
    if (dismissedMatch) {
      if (!shouldReopenAfterDismissal(clusterIds.length, dismissedMatch.occurrenceCountAtDismissal, PLAYBOOK_REOPEN_DELTA)) {
        return;
      }
      dismissedMatch.status = PlaybookCardStatus.CANDIDATE;
      dismissedMatch.occurrenceCount = clusterIds.length;
      dismissedMatch.trend = trend;
      dismissedMatch.evidence = evidence;
      dismissedMatch.sourceEntryIds = clusterIds;
      dismissedMatch.dismissedAt = null;
      dismissedMatch.dismissedBy = null;
      dismissedMatch.dismissedReason = null;
      dismissedMatch.occurrenceCountAtDismissal = null;
      await this.cardRepo.save(dismissedMatch);
      await this.notifyCandidate(entry.companyId, dismissedMatch);
      this.generateDraftAsync(dismissedMatch.id, evidence.map((e) => e.reviewSnippet), true);
      return;
    }

    const card = this.cardRepo.create({
      companyId: entry.companyId,
      errorTagId: null,
      // Временный заголовок до готовности черновика от ИИ — РОП увидит осмысленный сразу,
      // как только фоновая генерация допишет title (см. generateDraftAsync).
      title: 'Похожая ситуация в нескольких разборах',
      status: PlaybookCardStatus.CANDIDATE,
      occurrenceCount: clusterIds.length,
      trend,
      evidence,
      examples: [],
      detectionSource: 'semantic',
      sourceEntryIds: clusterIds,
      lastOccurrenceAt: new Date(),
    });
    const saved = await this.cardRepo.save(card);
    await this.notifyCandidate(entry.companyId, saved);
    this.generateDraftAsync(saved.id, evidence.map((e) => e.reviewSnippet), true);
  }

  // ───────────────────────── Release 2: черновик правила от ИИ ─────────────────────────

  /** Не блокирует ответ API — генерация на CPU занимает 10-20 секунд. РОП увидит черновик,
   *  когда откроет карточку; если Ollama недоступна, поле просто остаётся пустым и РОП
   *  пишет правило сам, как раньше. */
  private generateDraftAsync(cardId: string, evidenceQuotes: string[], needsTitle: boolean): void {
    const quotes = evidenceQuotes.filter(Boolean);
    if (!quotes.length) return;
    void this.runDraftGeneration(cardId, quotes, needsTitle).catch((e) => {
      this.logger.warn(`Черновик карточки ${cardId} не сгенерирован: ${(e as Error).message}`);
    });
  }

  private async runDraftGeneration(cardId: string, quotes: string[], needsTitle: boolean): Promise<void> {
    const raw = await this.ollama.generate(this.buildDraftPrompt(quotes), { maxTokens: 220 });
    if (!raw) return;
    const { title, rule } = this.parseDraft(raw);
    const update: Partial<PlaybookCard> = { draftRuleText: rule };
    if (needsTitle && title) update.title = title;
    await this.cardRepo.update({ id: cardId }, update);
  }

  private buildDraftPrompt(quotes: string[]): string {
    const numbered = quotes.map((q, i) => `${i + 1}) ${q}`).join('\n');
    return (
      'Ты помощник руководителя отдела продаж. Ниже — фрагменты РАЗБОРОВ звонков менеджеров ' +
      'одной компании, где руководитель отметил одну и ту же повторяющуюся ошибку. ' +
      'Работай ТОЛЬКО с текстом ниже, ничего не добавляй из общих знаний о продажах и не выдумывай деталей.\n\n' +
      `${numbered}\n\n` +
      'Ответь строго в этом формате, без вступлений:\n' +
      'ЗАГОЛОВОК: короткое название ошибки, 3-5 слов\n' +
      'ПРАВИЛО: как теперь делаем правильно, 2-3 предложения по-русски, без канцелярита'
    );
  }

  private parseDraft(raw: string): { title: string | null; rule: string } {
    const titleMatch = raw.match(/ЗАГОЛОВОК:\s*(.+)/i);
    const ruleMatch = raw.match(/ПРАВИЛО:\s*([\s\S]+)/i);
    const title = titleMatch ? titleMatch[1].split('\n')[0].trim() : null;
    const rule = (ruleMatch ? ruleMatch[1] : raw).trim();
    return { title, rule };
  }

  // ───────────────────────── Уведомление ─────────────────────────

  private async notifyCandidate(companyId: string, card: PlaybookCard): Promise<void> {
    try {
      const users = await this.usersService.findAll(companyId);
      const targets = users.filter((u) => u.role === UserRole.REVIEWER || u.role === UserRole.OWNER);
      for (const u of targets) {
        await this.notificationsService.create({
          userId: u.id,
          type: NotificationType.PLAYBOOK_CANDIDATE,
          title: 'Замечен повтор для методички',
          message: `«${card.title}»: уже ${card.occurrenceCount} раз за последние недели. Посмотрите доказательства и решите, включать ли в методичку.`,
          relatedId: card.id,
          linkUrl: '/playbook?tab=candidates',
        });
      }
    } catch (e) {
      this.logger.warn(`Уведомление о кандидате ${card.id} не отправлено: ${(e as Error).message}`);
    }
  }
}
