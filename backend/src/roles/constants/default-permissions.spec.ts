import { DEFAULT_ROLE_PERMISSIONS } from './default-permissions';
import { Permission } from '../enums/permission.enum';
import { UserRole } from '../../users/enums/user-role.enum';

// Регресс-сетка на права ролей: ловит будущее «случайно выдали трекеру лишнее право»
// раньше, чем это доедет до прода (аналог SEC-3 — трекер получил доступ к сбросу пароля
// через class-level CreateCompany, хотя Impersonate ему намеренно не выдан).
describe('DEFAULT_ROLE_PERMISSIONS — границы безопасности', () => {
  it('SUPERADMIN имеет все существующие права', () => {
    const all = new Set(Object.values(Permission));
    const superadmin = new Set(DEFAULT_ROLE_PERMISSIONS[UserRole.SUPERADMIN]);
    expect(superadmin).toEqual(all);
  });

  it('TRACKER — намеренно БЕЗ опасных прав (Impersonate/DeleteUser/DeleteCompany/ManageTrackers/ManageMethodology)', () => {
    const tracker = DEFAULT_ROLE_PERMISSIONS[UserRole.TRACKER];
    expect(tracker).not.toContain(Permission.Impersonate);
    expect(tracker).not.toContain(Permission.DeleteUser);
    expect(tracker).not.toContain(Permission.DeleteCompany);
    expect(tracker).not.toContain(Permission.ManageTrackers);
    expect(tracker).not.toContain(Permission.ManageMethodology);
  });

  it('MANAGER — без доступа к чужим данным компании (CreateCompany/ManageTrackers/DeleteUser)', () => {
    const manager = DEFAULT_ROLE_PERMISSIONS[UserRole.MANAGER];
    expect(manager).not.toContain(Permission.CreateCompany);
    expect(manager).not.toContain(Permission.ManageTrackers);
    expect(manager).not.toContain(Permission.DeleteUser);
    expect(manager).not.toContain(Permission.Impersonate);
  });

  it('REVIEWER — без Impersonate/ManageTrackers/DeleteCompany', () => {
    const reviewer = DEFAULT_ROLE_PERMISSIONS[UserRole.REVIEWER];
    expect(reviewer).not.toContain(Permission.Impersonate);
    expect(reviewer).not.toContain(Permission.ManageTrackers);
    expect(reviewer).not.toContain(Permission.DeleteCompany);
  });

  it('REVIEWER может удалить ошибочный черновик записи', () => {
    expect(DEFAULT_ROLE_PERMISSIONS[UserRole.REVIEWER]).toContain(Permission.DeleteEntry);
  });

  it('OWNER — без прав суперадмина (CreateCompany/Impersonate/ManageTrackers)', () => {
    const owner = DEFAULT_ROLE_PERMISSIONS[UserRole.OWNER];
    expect(owner).not.toContain(Permission.CreateCompany);
    expect(owner).not.toContain(Permission.Impersonate);
    expect(owner).not.toContain(Permission.ManageTrackers);
  });

  it('в списке прав каждой роли нет дублей', () => {
    for (const role of Object.values(UserRole)) {
      const list = DEFAULT_ROLE_PERMISSIONS[role];
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('каждая роль из enum UserRole имеет запись в DEFAULT_ROLE_PERMISSIONS', () => {
    for (const role of Object.values(UserRole)) {
      expect(DEFAULT_ROLE_PERMISSIONS[role]).toBeDefined();
    }
  });
});
