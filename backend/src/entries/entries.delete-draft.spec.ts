import { EntriesService } from './entries.service';
import { EntryStatus } from './enums/entry-status.enum';
import { UserRole } from '../users/enums/user-role.enum';

describe('EntriesService.remove — удаление ошибочного черновика РОПом', () => {
  function buildService(status: EntryStatus, companyId = 'company-1') {
    const entry = { id: 'entry-1', companyId, status } as any;
    const entriesRepository = {
      findOne: jest.fn().mockResolvedValue(entry),
      softRemove: jest.fn().mockResolvedValue(entry),
    };
    const service = new EntriesService(
      entriesRepository as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, entriesRepository };
  }

  it('РОП удаляет черновик менеджера своей компании', async () => {
    const { service, entriesRepository } = buildService(EntryStatus.DRAFT);

    await expect(service.remove('entry-1', 'company-1', UserRole.REVIEWER)).resolves.toBeUndefined();
    expect(entriesRepository.findOne).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry-1', companyId: 'company-1' },
    }));
    expect(entriesRepository.softRemove).toHaveBeenCalledTimes(1);
  });

  it.each([EntryStatus.SUBMITTED, EntryStatus.REVIEWED])(
    'РОП не может удалить запись в статусе %s',
    async (status) => {
      const { service, entriesRepository } = buildService(status);

      await expect(service.remove('entry-1', 'company-1', UserRole.REVIEWER)).rejects.toThrow(
        'РОП может удалить только черновик менеджера',
      );
      expect(entriesRepository.softRemove).not.toHaveBeenCalled();
    },
  );

  it('владелец сохраняет прежнее право удалить запись после отправки', async () => {
    const { service, entriesRepository } = buildService(EntryStatus.SUBMITTED);

    await service.remove('entry-1', 'company-1', UserRole.OWNER);
    expect(entriesRepository.softRemove).toHaveBeenCalledTimes(1);
  });
});
