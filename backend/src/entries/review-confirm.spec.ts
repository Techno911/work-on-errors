import { readFileSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { EntriesService } from './entries.service';
import { ReviewConfirmDto } from './dto/review-confirm.dto';
import { EntryStatus } from './enums/entry-status.enum';
import { sha256Text } from '../common/text-hash.util';

/**
 * Личное подтверждение чтения разбора (review-reread-confirm). Замки: серверный автор,
 * узкий DTO, один защищённый UPDATE по ФАКТИЧЕСКОМУ тексту записи (не кешу хеша),
 * ответ строго из RETURNING, CAS по lastSeenRereadAt против технического повтора,
 * защита полей подтверждения от затирания полным save() в review(), отсутствие
 * новых полей в публичном share.
 */

const HASH = sha256Text('Текст разбора');
const REREAD_TS = '2026-10-17T10:04:12.611Z';

const baseEntry = (over: Record<string, unknown> = {}) => ({
  id: 'e-1',
  companyId: 'co-1',
  managerId: 'mgr-1',
  status: EntryStatus.REVIEWED,
  reviewText: 'Текст разбора',
  reviewTextHash: HASH,
  reviewConfirmedHash: null,
  reviewConfirmedAt: null,
  reviewRereadAt: null,
  deletedAt: null,
  errorTags: [],
  ...over,
});

function makeService(rawAffected = 1, rawRows: unknown[] = []) {
  const qbSet = jest.fn().mockReturnThis();
  const qbWhere = jest.fn().mockReturnThis();
  const qbSetParam = jest.fn().mockReturnThis();
  const qbReturning = jest.fn().mockReturnThis();
  const qbExecute = jest.fn().mockResolvedValue({ affected: rawAffected, raw: rawRows });
  const entriesRepository = {
    findOne: jest.fn(),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    save: jest.fn(async (e: unknown) => e),
    createQueryBuilder: jest.fn(() => ({
      update: jest.fn().mockReturnThis(),
      set: qbSet,
      setParameter: qbSetParam,
      where: qbWhere,
      returning: qbReturning,
      execute: qbExecute,
    })),
  };
  const service = new EntriesService(
    entriesRepository as never,
    {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never,
    {} as never, {} as never, {} as never,
  );
  return { service, entriesRepository, qbSet, qbWhere, qbExecute, qbReturning };
}

const manager = { id: 'mgr-1', companyId: 'co-1' };

describe('ReviewConfirmDto', () => {
  it('принимает 64-hex expectedHash и опциональный ISO lastSeenRereadAt', async () => {
    expect(await validate(plainToInstance(ReviewConfirmDto, { expectedHash: HASH }))).toHaveLength(0);
    expect(await validate(plainToInstance(ReviewConfirmDto, { expectedHash: HASH, lastSeenRereadAt: null }))).toHaveLength(0);
    expect(await validate(plainToInstance(ReviewConfirmDto, { expectedHash: HASH, lastSeenRereadAt: REREAD_TS }))).toHaveLength(0);
    for (const bad of ['abc', HASH.toUpperCase(), HASH + '0', 42]) {
      expect((await validate(plainToInstance(ReviewConfirmDto, { expectedHash: bad }))).length).toBeGreaterThan(0);
    }
    for (const badDate of ['не-дата', '2026-13-45', 42]) {
      expect((await validate(plainToInstance(ReviewConfirmDto, { expectedHash: HASH, lastSeenRereadAt: badDate }))).length).toBeGreaterThan(0);
    }
  });
});

describe('confirmReview', () => {
  const ROW = {
    reviewConfirmedAt: new Date('2026-10-17T10:04:12.611Z'),
    reviewRereadAt: new Date('2026-10-17T13:00:00.000Z'),
    reviewConfirmedHash: HASH,
    reviewTextHash: HASH,
  };

  it('один защищённый UPDATE по фактическому тексту + RETURNING четырёх полей', async () => {
    const { service, qbSet, qbWhere, qbReturning } = makeService(1, [ROW]);
    jest.spyOn(service, 'findById').mockResolvedValue(baseEntry() as never);
    const res = await service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: null }, manager);
    // Ответ — строго строка RETURNING, не предчтение и не сочинённые значения
    expect(res).toEqual(ROW);
    expect(qbReturning).toHaveBeenCalledWith(expect.arrayContaining([
      'reviewConfirmedAt', 'reviewRereadAt', 'reviewConfirmedHash', 'reviewTextHash',
    ]));
    // Предикат по ТЕКСТУ записи, не по кешу хеша; кеш чинится в том же SET.
    const where = qbWhere.mock.calls[0][0] as string;
    for (const frag of [
      '"managerId" = :uid', '"companyId" = :cid', "status = 'reviewed'",
      '"deletedAt" IS NULL', '"reviewText" IS NOT DISTINCT FROM :textAtRead',
      '"reviewRereadAt" IS NOT DISTINCT FROM CAST(:lastSeen',
    ]) {
      expect(where).toContain(frag);
    }
    expect(where).not.toContain('"reviewTextHash" IS NOT DISTINCT');
    const setArg = qbSet.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.reviewTextHash).toBe(HASH); // SET cache в том же клейме
    expect(setArg.reviewConfirmedHash).toBe(HASH);
  });

  it('F1: устаревший НЕNULL-кеш хеша — 409 по фактическому тексту, отдельный self-heal не выполняется', async () => {
    const { service, qbExecute } = makeService();
    // Кеш говорит hash(T1), фактический текст — T2 (изменён «старым» backend)
    jest.spyOn(service, 'findById').mockResolvedValue(
      baseEntry({ reviewText: 'Подменённый текст', reviewTextHash: HASH }) as never);
    await expect(service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: null }, manager))
      .rejects.toBeInstanceOf(ConflictException);
    expect(qbExecute).not.toHaveBeenCalled();
  });

  it('F2: ответ собирается из RETURNING — параллельный первый клейм отдаёт серверные штампы', async () => {
    const firstRow = { ...ROW, reviewConfirmedAt: new Date('2026-10-17T10:04:12.761Z') };
    const { service } = makeService(1, [firstRow]);
    jest.spyOn(service, 'findById').mockResolvedValue(baseEntry() as never);
    const res = await service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: null }, manager);
    expect(res.reviewConfirmedAt).toEqual(firstRow.reviewConfirmedAt);
  });

  it('F3: технический повтор — CAS не прошёл, возвращаем текущее авторитетное состояние без нового штампа', async () => {
    const { service } = makeService(0); // affected 0
    const current = baseEntry({
      reviewConfirmedHash: HASH,
      reviewConfirmedAt: new Date('2026-10-17T10:04:12.611Z'),
      reviewRereadAt: new Date('2026-10-17T11:00:00.000Z'),
    });
    jest.spyOn(service, 'findById')
      .mockResolvedValueOnce(baseEntry() as never)   // предчтение
      .mockResolvedValueOnce(current as never);      // перечитывание после 0-affected
    const res = await service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: '2026-10-17T10:59:00.000Z' }, manager);
    expect(res.reviewConfirmedHash).toBe(HASH);
    expect(res.reviewRereadAt).toEqual(new Date('2026-10-17T11:00:00.000Z'));
  });

  it('F3: CAS-повтор на чужой/испорченной записи — не 200 «уже есть», а честные 403/409', async () => {
    const { service } = makeService(0);
    jest.spyOn(service, 'findById')
      .mockResolvedValueOnce(baseEntry() as never)
      .mockResolvedValueOnce(baseEntry({ managerId: 'other' }) as never);
    await expect(service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: REREAD_TS }, manager))
      .rejects.toBeInstanceOf(ForbiddenException);
    const { service: s2 } = makeService(0);
    jest.spyOn(s2, 'findById')
      .mockResolvedValueOnce(baseEntry() as never)
      .mockResolvedValueOnce(baseEntry({ reviewText: 'Другой текст' }) as never);
    await expect(s2.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: REREAD_TS }, manager))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('403: чужая запись; 400: неразобранная', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findById')
      .mockResolvedValueOnce(baseEntry({ managerId: 'other' }) as never)
      .mockResolvedValueOnce(baseEntry({ status: EntryStatus.SUBMITTED }) as never);
    await expect(service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: null }, manager)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.confirmReview('e-1', { expectedHash: HASH, lastSeenRereadAt: null }, manager)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('review(): поля подтверждения не затираются снимком', () => {
  it('перед save() confirm-поля удаляются из entity — гонка confirm→edit не откатывает факт', async () => {
    const { service, entriesRepository } = makeService();
    const entry = baseEntry({
      reviewConfirmedHash: HASH,
      reviewConfirmedAt: new Date('2026-10-15'),
      reviewRereadAt: new Date('2026-10-16'),
    });
    jest.spyOn(service, 'findById').mockResolvedValue(entry as never);
    const companiesService = (service as never as { companiesService: { getSettings: jest.Mock } }).companiesService;
    companiesService.getSettings = jest.fn().mockResolvedValue({ minReviewChars: 10 });
    await service.review('e-1', { reviewText: 'Новый текст разбора с достаточной длиной', tagIds: [] } as never, 'rop-1', 'co-1');
    const saved = entriesRepository.save.mock.calls[0][0] as Record<string, unknown>;
    expect('reviewConfirmedHash' in saved).toBe(false);
    expect('reviewConfirmedAt' in saved).toBe(false);
    expect('reviewRereadAt' in saved).toBe(false);
    expect(saved.reviewTextHash).toBe(sha256Text('Новый текст разбора с достаточной длиной'));
  });
});

describe('getRecentReviews расширение', () => {
  it('подборка разборов: requireText отсекает и пробельный текст (btrim), offset, стабильный reviewedAt+id порядок', async () => {
    const { service, entriesRepository } = makeService();
    await service.getRecentReviews('mgr-1', 5, 'co-1', { offset: 10, orderBy: 'reviewedAt', requireText: true });
    const arg = entriesRepository.find.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.take).toBe(5);
    expect(arg.skip).toBe(10);
    expect(arg.order).toEqual({ reviewedAt: 'DESC', id: 'DESC' });
    const wt = (arg.where as Record<string, { _getSql?: (a: string) => string }>).reviewText;
    // Полный whitespace-класс (пробел/таб/LF/CR), не только ASCII space.
    expect(wt && wt._getSql?.('x')).toContain("x !~ '^[[:space:]]*$'");
  });

  it('прежний вызов без параметров сохраняет старый контракт (limit 3, updatedAt DESC)', async () => {
    const { service, entriesRepository } = makeService();
    await service.getRecentReviews('mgr-1', 3, 'co-1');
    const arg = entriesRepository.find.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.order).toEqual({ updatedAt: 'DESC' });
    expect(arg.take).toBe(3);
    expect(arg.skip).toBe(0);
    expect((arg.where as Record<string, unknown>).reviewText).toBeUndefined();
  });
});

describe('share: персональные поля не протекают в публичную страницу', () => {
  it('renderHtml не упоминает поля подтверждения', () => {
    const src = readFileSync(join(__dirname, '..', 'share', 'share.service.ts'), 'utf8');
    expect(src).not.toMatch(/reviewConfirm|reviewReread|reviewTextHash/i);
  });
});
