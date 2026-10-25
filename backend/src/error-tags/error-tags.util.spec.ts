import { ErrorTagsService, normalizeTagName } from './error-tags.service';
import { ErrorTag } from './entities/error-tag.entity';
import type { Repository } from 'typeorm';

describe('normalizeTagName — решётка это оформление показа, не часть имени', () => {
  it('реальный случай 28.07.2026: тег создан по образцу из инструкции РОПа с решёткой — убираем её', () => {
    expect(normalizeTagName('#не_доносит_разницу_с_ручником')).toBe('не_доносит_разницу_с_ручником');
  });

  it('несколько решёток подряд тоже убираются', () => {
    expect(normalizeTagName('##тег')).toBe('тег');
  });

  it('тег без решётки не меняется, кроме обрезки пробелов', () => {
    expect(normalizeTagName('  медленно_реагирует  ')).toBe('медленно_реагирует');
  });
});

describe('цвет нового тега при старом SQL default и сохранность выбранного цвета', () => {
  const existing = { id: 'existing', companyId: 'company', name: 'старый', color: '#F97316' };
  const setup = () => {
    const repository = {
      create: jest.fn((data: Partial<ErrorTag>) => ({ ...data })),
      // Эмулируем старый production-default, который не меняется без миграции.
      save: jest.fn(async (data: Partial<ErrorTag>) => ({ color: '#F97316', ...data })),
      findOne: jest.fn(async () => ({ ...existing })),
    };
    return { repository, service: new ErrorTagsService(repository as unknown as Repository<ErrorTag>) };
  };

  it('создание без цвета получает янтарный даже при старой схеме', async () => {
    const { service, repository } = setup();
    const result = await service.create({ companyId: 'company', name: '#новый' });
    expect(result).toMatchObject({ color: '#B45309', name: 'новый' });
    expect(repository.save).toHaveBeenCalledTimes(1);
  });

  it.each(['#F97316', '#EF4444', '#123456'])('явный пользовательский цвет %s сохраняется', async color => {
    const { service } = setup();
    expect(await service.create({ companyId: 'company', name: 'новый', color })).toMatchObject({ color });
  });

  it('переименование существующего оранжевого тега не перекрашивает его', async () => {
    const { service } = setup();
    expect(await service.update('existing', { name: 'новое_имя' }, 'company')).toMatchObject({ color: '#F97316', name: 'новое_имя' });
  });
});
