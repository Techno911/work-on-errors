export enum UserRole {
  SUPERADMIN = 'superadmin',
  // Трекер: производственный отдел ЧиП. Видит все компании и ведёт онбординг,
  // но без опасных действий суперадмина (impersonation, удаление людей, управление трекерами).
  TRACKER = 'tracker',
  OWNER = 'owner',
  REVIEWER = 'reviewer',
  MANAGER = 'manager',
}

/**
 * Роли команды клиента (не наши служебные). Единый источник для механизмов, которые
 * различают «люди клиента» и «люди ЧиП»: доставка доступов в рабочий чат, сторож
 * непришедших, уведомления о смене состава. Раньше этот список писался копией в каждом
 * месте (ROLE_LABEL в admin.service), и новая роль расходилась бы по копиям молча.
 */
export const TEAM_ROLES: UserRole[] = [UserRole.OWNER, UserRole.REVIEWER, UserRole.MANAGER];
