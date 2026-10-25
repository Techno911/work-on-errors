import { UserRole } from '../../users/enums/user-role.enum';
import { Permission } from '../enums/permission.enum';

export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPERADMIN]: Object.values(Permission),

  // Трекер (производственный отдел ЧиП): ведёт онбординг всех компаний.
  // Осознанно НЕТ: DeleteCompany, DeleteUser, Impersonate, ManageTrackers, ManageMethodology.
  [UserRole.TRACKER]: [
    Permission.CreateCompany, // класс AdminController гейтит этим правом — даёт доступ к панели
    Permission.ReadCompany,
    Permission.UpdateCompany,
    Permission.CreateUser,
    Permission.ReadUser,
    Permission.UpdateUser,
    Permission.InviteUser,
    Permission.ReadSprint,
    Permission.ReadEntry,
    Permission.ReadAllEntries,
    Permission.ViewAnalytics,
  ],

  [UserRole.OWNER]: [
    Permission.ReadCompany,
    Permission.UpdateCompany,
    Permission.CreateUser,
    Permission.ReadUser,
    Permission.UpdateUser,
    Permission.DeleteUser,
    Permission.InviteUser,
    Permission.CreateSprint,
    Permission.ReadSprint,
    Permission.UpdateSprint,
    Permission.CreateEntry,
    Permission.ReadEntry,
    Permission.ReadAllEntries,
    Permission.UpdateEntry,
    Permission.DeleteEntry,
    Permission.SubmitReview,
    Permission.TagErrors,
    Permission.ManageTags,
    Permission.ViewAnalytics,
    Permission.ManageMethodology,
  ],

  [UserRole.REVIEWER]: [
    Permission.ReadCompany,
    Permission.ReadUser,
    Permission.InviteUser,
    Permission.CreateSprint,
    Permission.ReadSprint,
    Permission.UpdateSprint,
    Permission.ReadEntry,
    Permission.ReadAllEntries,
    // РОП может убрать ошибочно созданный черновик менеджера. Сам сервис ограничивает
    // это право статусом DRAFT: отправленные и проверенные записи остаются в истории.
    Permission.DeleteEntry,
    Permission.SubmitReview,
    Permission.TagErrors,
    Permission.ManageTags,
    Permission.ViewAnalytics,
    // РОП — главный пользователь методички (решение владельца продукта: сама разбирает
    // повторы и решает; владелец видит и правит, но собирает именно РОП, как в стандарте
    // «Работа над ошибками» — «главный читатель РОП, владелец вторичен»).
    Permission.ManageMethodology,
  ],

  [UserRole.MANAGER]: [
    Permission.ReadCompany,
    Permission.ReadUser,
    Permission.ReadSprint,
    Permission.CreateEntry,
    Permission.ReadEntry,
    Permission.UpdateEntry,
    Permission.TakeAttestation,
  ],
};
