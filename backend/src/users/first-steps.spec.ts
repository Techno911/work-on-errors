import { readFileSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UsersService } from './users.service';
import { SetFirstStepsHiddenDto } from './dto/set-first-steps-hidden.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';

/**
 * Личное скрытие/возврат учебной карточки «Первые шаги» (change dismissible-first-steps).
 * Замок держит четыре вещи: предпочтение пишется только о себе отдельным endpoint,
 * не протекает через общий PATCH, сбрасывается при фактической смене роли/компании
 * и идемпотентно при повторе.
 */

const baseUser = (over: Partial<User> = {}): User =>
  ({
    id: 'u-1',
    email: 'm@example.invalid',
    fullName: 'Менеджер',
    role: UserRole.MANAGER,
    companyId: 'co-1',
    firstStepsHiddenAt: null,
    isActive: true,
    ...over,
  }) as User;

function makeService() {
  const usersRepository = {
    save: jest.fn(async (u: User) => u),
    update: jest.fn(async () => ({})),
    createQueryBuilder: jest.fn(),
  };
  const service = new UsersService(
    usersRepository as never,
    {} as never, // DataSource
    { log: jest.fn() } as never, // CompanyEventsService
  );
  return { service, usersRepository };
}

describe('setFirstStepsHidden', () => {
  it('ставит штамп при hidden=true и снимает при false', async () => {
    const { service } = makeService();
    const user = baseUser();
    jest.spyOn(service, 'findById').mockResolvedValue(user);

    const hidden = await service.setFirstStepsHidden('u-1', true);
    expect(hidden.firstStepsHiddenAt).toBeInstanceOf(Date);

    const shown = await service.setFirstStepsHidden('u-1', false);
    expect(shown.firstStepsHiddenAt).toBeNull();
  });

  it('идемпотентен: повтор пишет то же значение без ошибки', async () => {
    const { service } = makeService();
    jest.spyOn(service, 'findById').mockResolvedValue(baseUser());

    const a = await service.setFirstStepsHidden('u-1', true);
    const b = await service.setFirstStepsHidden('u-1', true);
    expect(a.firstStepsHiddenAt).not.toBeNull();
    expect(b.firstStepsHiddenAt).not.toBeNull();
  });
});

describe('DTO и границы endpoint', () => {
  it('принимает только boolean', async () => {
    const ok = plainToInstance(SetFirstStepsHiddenDto, { hidden: true });
    expect(await validate(ok)).toHaveLength(0);

    const bad = plainToInstance(SetFirstStepsHiddenDto, { hidden: 'да' });
    expect((await validate(bad)).length).toBeGreaterThan(0);
  });

  it('firstStepsHiddenAt не пробивается через UpdateUserDto (защита чужой отметки)', () => {
    // Структурный замок по образцу releasesSeenVersion: поле не должно появиться в общем DTO,
    // иначе PATCH /users/:id от админа сбрасывал бы личное предпочтение сотрудника.
    const src = readFileSync(join(__dirname, 'dto', 'update-user.dto.ts'), 'utf8');
    expect(src).not.toMatch(/firstStepsHidden/i);

    // И на уровне объявления класса: поля нет, значит ValidationPipe(whitelist) его срежет.
    expect(Object.getOwnPropertyNames(new UpdateUserDto())).not.toContain('firstStepsHiddenAt');
  });
});

describe('сброс скрытия при смене контекста', () => {
  it('смена роли сбрасывает firstStepsHiddenAt', async () => {
    const { service, usersRepository } = makeService();
    const hiddenUser = baseUser({ firstStepsHiddenAt: new Date('2026-10-01') });
    jest.spyOn(service, 'findById').mockResolvedValue(hiddenUser);

    await service.update('u-1', { role: UserRole.REVIEWER } as UpdateUserDto);
    expect(hiddenUser.firstStepsHiddenAt).toBeNull();
    expect(usersRepository.save).toHaveBeenCalled();
  });

  it('смена компании сбрасывает firstStepsHiddenAt', async () => {
    const { service } = makeService();
    const hiddenUser = baseUser({ firstStepsHiddenAt: new Date('2026-10-01') });
    jest.spyOn(service, 'findById').mockResolvedValue(hiddenUser);

    await service.update('u-1', { companyId: 'co-2' } as UpdateUserDto);
    expect(hiddenUser.firstStepsHiddenAt).toBeNull();
  });

  it('передача прежней роли и правка другого поля выбор НЕ трогают', async () => {
    const { service } = makeService();
    const stamp = new Date('2026-10-01');
    const hiddenUser = baseUser({ firstStepsHiddenAt: stamp });
    jest.spyOn(service, 'findById').mockResolvedValue(hiddenUser);

    await service.update('u-1', { role: UserRole.MANAGER, fullName: 'Новое Имя' } as UpdateUserDto);
    expect(hiddenUser.firstStepsHiddenAt).toBe(stamp);

    await service.update('u-1', { fullName: 'Ещё Имя' } as UpdateUserDto);
    expect(hiddenUser.firstStepsHiddenAt).toBe(stamp);
  });

  it('updateCompanyAndRole (приглашение/оферта) сбрасывает скрытие', async () => {
    const { service, usersRepository } = makeService();
    await service.updateCompanyAndRole('u-1', 'co-9', UserRole.REVIEWER);
    expect(usersRepository.update).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ firstStepsHiddenAt: null }),
    );
  });
});
