import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlaybookCard, PlaybookCardStatus } from './entities/playbook-card.entity';
import { ConfirmCandidateDto } from './dto/confirm-candidate.dto';
import { DismissCardDto } from './dto/dismiss-card.dto';
import { UpdatePlaybookCardDto, CreateManualCardDto } from './dto/update-playbook-card.dto';
import { PLAYBOOK_TARGET_CARDS, isCardOverdue, nextReviewDueDate } from './playbook.util';

@Injectable()
export class PlaybookService {
  constructor(
    @InjectRepository(PlaybookCard)
    private readonly cardRepo: Repository<PlaybookCard>,
  ) {}

  private async findScoped(id: string, companyId: string): Promise<PlaybookCard> {
    const card = await this.cardRepo.findOne({ where: { id, companyId } });
    if (!card) throw new NotFoundException('Карточка методички не найдена');
    return card;
  }

  /** Методичка, которую видит команда: активные карточки, свежие сверху. */
  async listActive(companyId: string) {
    const cards = await this.cardRepo.find({
      where: { companyId, status: PlaybookCardStatus.ACTIVE },
      order: { confirmedAt: 'DESC' },
    });
    return cards.map((c) => ({ ...c, isOverdue: isCardOverdue(c.reviewDueAt) }));
  }

  /** Очередь решений РОПа — то, что система заметила и ждёт подтверждения или отклонения. */
  async listCandidates(companyId: string) {
    return this.cardRepo.find({
      where: { companyId, status: PlaybookCardStatus.CANDIDATE },
      order: { occurrenceCount: 'DESC' },
    });
  }

  /** Счётчик для полосы прогресса «сколько карточек до первой версии». */
  async getProgress(companyId: string) {
    const activeCount = await this.cardRepo.count({ where: { companyId, status: PlaybookCardStatus.ACTIVE } });
    const candidatesWaiting = await this.cardRepo.count({ where: { companyId, status: PlaybookCardStatus.CANDIDATE } });
    return { activeCount, target: PLAYBOOK_TARGET_CARDS, candidatesWaiting };
  }

  async confirm(id: string, companyId: string, dto: ConfirmCandidateDto, userId: string, userName: string): Promise<PlaybookCard> {
    const card = await this.findScoped(id, companyId);
    if (card.status !== PlaybookCardStatus.CANDIDATE) {
      throw new BadRequestException('Подтвердить можно только карточку, которая ждёт решения');
    }
    card.status = PlaybookCardStatus.ACTIVE;
    card.ruleText = dto.ruleText;
    if (dto.title) card.title = dto.title;
    // Доказательства, на основании которых приняли решение, становятся первыми примерами карточки —
    // РОП увидел их при подтверждении, незачем печатать заново вручную.
    if (card.examples.length === 0 && card.evidence.length > 0) {
      card.examples = card.evidence.slice(0, 2).map((e) => ({
        kind: 'bad' as const,
        quote: e.reviewSnippet,
        entryId: e.entryId,
      }));
    }
    card.ownerId = userId;
    card.ownerName = userName;
    card.confirmedAt = new Date();
    card.confirmedBy = userId;
    card.reviewDueAt = nextReviewDueDate(card.confirmedAt);
    card.version += 1;
    return this.cardRepo.save(card);
  }

  async dismiss(id: string, companyId: string, dto: DismissCardDto, userId: string): Promise<PlaybookCard> {
    const card = await this.findScoped(id, companyId);
    if (card.status === PlaybookCardStatus.DISMISSED) {
      throw new BadRequestException('Карточка уже отклонена');
    }
    card.status = PlaybookCardStatus.DISMISSED;
    card.dismissedAt = new Date();
    card.dismissedBy = userId;
    card.dismissedReason = dto.reason ?? null;
    card.occurrenceCountAtDismissal = card.occurrenceCount;
    return this.cardRepo.save(card);
  }

  async update(id: string, companyId: string, dto: UpdatePlaybookCardDto): Promise<PlaybookCard> {
    const card = await this.findScoped(id, companyId);
    if (dto.title !== undefined) card.title = dto.title;
    if (dto.ruleText !== undefined) card.ruleText = dto.ruleText;
    if (dto.examples !== undefined) card.examples = dto.examples;
    card.version += 1;
    return this.cardRepo.save(card);
  }

  /** Ручная карточка вне детекции — «вот эта ситуация у нас есть, но она не про один тег». */
  async createManual(companyId: string, dto: CreateManualCardDto, userId: string, userName: string): Promise<PlaybookCard> {
    const card = this.cardRepo.create({
      companyId,
      errorTagId: null,
      title: dto.title,
      ruleText: dto.ruleText ?? null,
      status: dto.ruleText ? PlaybookCardStatus.ACTIVE : PlaybookCardStatus.CANDIDATE,
      ownerId: userId,
      ownerName: userName,
      confirmedAt: dto.ruleText ? new Date() : null,
      confirmedBy: dto.ruleText ? userId : null,
      reviewDueAt: dto.ruleText ? nextReviewDueDate() : null,
      examples: [],
      evidence: [],
    });
    return this.cardRepo.save(card);
  }

  /** Все активные карточки без служебных полей — материал для сборки документа на фронте. */
  async getExportData(companyId: string) {
    const cards = await this.listActive(companyId);
    return cards.map((c) => ({
      title: c.title,
      ruleText: c.ruleText,
      examples: c.examples,
      occurrenceCount: c.occurrenceCount,
      ownerName: c.ownerName,
      confirmedAt: c.confirmedAt,
    }));
  }
}
