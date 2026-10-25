import { EntriesService } from './entries.service';
import { EntryStatus } from './enums/entry-status.enum';

// Замок на дефект, найденный у живого клиента 29.07.2026: РОП одного клиента открыл свой
// сохранённый разбор, дописал теги, нажал «Сохранить» — и получал 400 «Ревью можно написать
// только для отправленной записи» на каждую попытку. Форма правку показывала, сервис её
// запрещал. Тест держит ОБА берега: правка проходит, но не превращается в повторный разбор
// (не сдвигает reviewedAt, не переписывает авторство, не начисляет XP заново) — иначе
// поедут норматив разбора и премия РОПа, которые считаются именно от этих полей.
describe('EntriesService.review — правка уже сохранённого разбора', () => {
  const FIRST_REVIEWED_AT = new Date('2026-07-29T15:40:13.867Z');
  const AUTHOR_ID = 'rop-author';

  function buildService(status: EntryStatus) {
    const entry: any = {
      id: 'e1',
      companyId: 'c1',
      managerId: 'm1',
      sprintId: 's1',
      entryNumber: 4,
      status,
      reviewText: 'Первоначальный разбор',
      reviewerId: status === EntryStatus.REVIEWED ? AUTHOR_ID : null,
      reviewedAt: status === EntryStatus.REVIEWED ? FIRST_REVIEWED_AT : null,
      errorTags: [],
    };

    const entriesRepository = {
      findOne: jest.fn().mockResolvedValue(entry),
      save: jest.fn().mockImplementation((x: any) => Promise.resolve(x)),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      // Журнал событий компании спрашивает, первый ли это разбор: 2 = не первый, событие не пишем.
      count: jest.fn().mockResolvedValue(2),
    };
    const errorTagsRepository = {
      find: jest.fn().mockResolvedValue([{ id: 't1', companyId: 'c1' }]),
    };
    const companiesService = { getSettings: jest.fn().mockResolvedValue({ minReviewChars: 10 }) };
    const notificationsService = {
      create: jest.fn().mockResolvedValue({}),
      markReadByRelatedId: jest.fn().mockResolvedValue({}),
    };
    const gamificationService = { onReviewReceived: jest.fn().mockResolvedValue(undefined) };
    const playbookDetectionService = { checkEntry: jest.fn().mockResolvedValue(undefined) };

    const service = new EntriesService(
      entriesRepository as any,
      {} as any,
      errorTagsRepository as any,
      {} as any,
      companiesService as any,
      notificationsService as any,
      {} as any,
      {} as any,
      gamificationService as any,
      {} as any,
      {} as any,
      playbookDetectionService as any,
      { log: jest.fn().mockResolvedValue(undefined), logDelivery: jest.fn().mockResolvedValue(undefined) } as any,
    );

    return { service, entry, entriesRepository, notificationsService, gamificationService };
  }

  const dto = { reviewText: 'Уточнённый разбор достаточной длины', tagIds: ['t1'] } as any;

  it('правка сохранённого разбора проходит, а не падает 400', async () => {
    const { service } = buildService(EntryStatus.REVIEWED);
    await expect(service.review('e1', dto, 'rop-any', 'c1')).resolves.toBeDefined();
  });

  it('правка не сдвигает reviewedAt и не переписывает авторство (от них считается премия РОПа)', async () => {
    const { service, entry } = buildService(EntryStatus.REVIEWED);
    await service.review('e1', dto, 'another-rop', 'c1');
    expect(entry.reviewedAt).toEqual(FIRST_REVIEWED_AT);
    expect(entry.reviewerId).toBe(AUTHOR_ID);
    expect(entry.reviewText).toBe(dto.reviewText);
  });

  it('правка не начисляет XP менеджеру повторно', async () => {
    const { service, gamificationService } = buildService(EntryStatus.REVIEWED);
    await service.review('e1', dto, AUTHOR_ID, 'c1');
    expect(gamificationService.onReviewReceived).not.toHaveBeenCalled();
  });

  it('первый разбор по-прежнему проставляет статус, автора, дату и XP', async () => {
    const { service, entry, gamificationService } = buildService(EntryStatus.SUBMITTED);
    await service.review('e1', dto, AUTHOR_ID, 'c1');
    expect(entry.status).toBe(EntryStatus.REVIEWED);
    expect(entry.reviewerId).toBe(AUTHOR_ID);
    expect(entry.reviewedAt).toBeInstanceOf(Date);
    expect(gamificationService.onReviewReceived).toHaveBeenCalledTimes(1);
  });

  it('черновик разбирать по-прежнему нельзя', async () => {
    const { service } = buildService(EntryStatus.DRAFT);
    await expect(service.review('e1', dto, AUTHOR_ID, 'c1')).rejects.toThrow(
      'Ревью можно написать только для отправленной записи',
    );
  });

  it('менеджер узнаёт, что разбор дополнили', async () => {
    const { service, notificationsService } = buildService(EntryStatus.REVIEWED);
    await service.review('e1', dto, AUTHOR_ID, 'c1');
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'm1', title: 'Разбор дополнен' }),
    );
  });
});
