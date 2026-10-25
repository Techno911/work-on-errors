import { DashboardService } from './dashboard.service';
import { SprintStatus } from '../sprints/enums/sprint-status.enum';

/**
 * Пожизненные флаги первых шагов (change dismissible-first-steps): они считаются по фактам
 * за всё время в своей компании и не зависят от текущей недели, спринта и очереди.
 * Замок: недельные progress.* при этом остаются прежними.
 */

const company = {
  id: 'co-1',
  timezone: 'Europe/Moscow',
  callsEnabled: true,
  chatsEnabled: true,
};

function qb(getCount: number) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getCount: jest.fn().mockResolvedValue(getCount),
  };
}

function makeService(opts: { entriesCount?: number; selfReviewCount?: number; reviewCount?: number; sprint?: unknown }) {
  const selfReviewQb = qb(opts.selfReviewCount ?? 0);
  const reviewQb = qb(opts.reviewCount ?? 0);
  // getManagerData зовёт один QB (selfReview), getReviewerData — другой (reviews):
  // различаем по первому условию where-строки.
  const qbFactory = jest.fn(() => selfReviewQb);

  const entriesRepository = {
    count: jest.fn().mockResolvedValue(opts.entriesCount ?? 0),
    find: jest.fn().mockResolvedValue([]),
    createQueryBuilder: jest.fn((alias: string, whereHint?: string) =>
      whereHint?.includes('reviewerId') ? reviewQb : selfReviewQb,
    ),
  };
  // TypeORM createQueryBuilder с условиями через .where() — условия в цепочке, поэтому
  // фабрика отдаёт последний созданный qb; для reviewer-теста подменяем напрямую.
  const service = new DashboardService(
    { findOne: jest.fn().mockResolvedValue(opts.sprint ?? null) } as never,
    entriesRepository as never,
    { findOne: jest.fn().mockResolvedValue(company) } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, selfReviewQb, reviewQb, entriesRepository, qbFactory };
}

describe('getManagerData.firstSteps', () => {
  it('без спринта возвращает all-time флаги: опытный не новичок', async () => {
    const { service } = makeService({ entriesCount: 7, selfReviewCount: 3, sprint: null });
    const data = await service.getManagerData('co-1', 'mgr-1');
    expect(data.sprint).toBeNull();
    expect(data.firstSteps).toEqual({ hasEntries: true, hasSelfReview: true });
  });

  it('новичок: записей и самоанализов за всё время нет', async () => {
    const { service } = makeService({ entriesCount: 0, selfReviewCount: 0, sprint: null });
    const data = await service.getManagerData('co-1', 'mgr-1');
    expect(data.firstSteps).toEqual({ hasEntries: false, hasSelfReview: false });
  });

  it('самоанализ считается по managerId+companyId за всё время, без границы спринта', async () => {
    const { service, entriesRepository } = makeService({ entriesCount: 5, selfReviewCount: 1, sprint: null });
    await service.getManagerData('co-1', 'mgr-1');
    const qb = entriesRepository.createQueryBuilder.mock.results[0].value;
    expect(qb.where).toHaveBeenCalledWith('e."managerId" = :managerId', { managerId: 'mgr-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('e."companyId" = :companyId', { companyId: 'co-1' });
    expect(qb.andWhere).toHaveBeenCalledWith('e."deletedAt" IS NULL');
    const calls = qb.andWhere.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls.some((c: string) => c.includes('selfReviewCorrect'))).toBe(true);
    // Никакой границы по sprintId/датам в условии быть не должно.
    expect(calls.some((c: string) => /sprint|createdAt|startDate/i.test(c))).toBe(false);
  });
});

describe('getReviewerData.firstSteps', () => {
  it('РОП с ревью прошлых периодов — обучение завершено, даже без спринта', async () => {
    const { service, entriesRepository } = makeService({ sprint: null });
    // Подменяем фабрику QB: reviewer-запрос возвращает 1 ревью.
    entriesRepository.createQueryBuilder.mockReturnValue(qb(1) as never);
    const data = await service.getReviewerData('co-1', 'rop-1');
    expect(data.firstSteps).toEqual({ hasReviews: true });
  });

  it('РОП без истории ревью и с пустой очередью — обучение НЕ завершено', async () => {
    const { service, entriesRepository } = makeService({ sprint: null });
    entriesRepository.createQueryBuilder.mockReturnValue(qb(0) as never);
    const data = await service.getReviewerData('co-1', 'rop-1');
    expect(data.pendingCount).toBe(0);
    expect(data.firstSteps).toEqual({ hasReviews: false });
  });

  it('без reviewerId не считает чужие ревью своими', async () => {
    const { service, entriesRepository } = makeService({ sprint: null });
    entriesRepository.createQueryBuilder.mockReturnValue(qb(9) as never);
    const data = await service.getReviewerData('co-1');
    expect(data.firstSteps).toEqual({ hasReviews: false });
  });
});
