export enum Permission {
  // Companies
  CreateCompany = 'company:create',
  ReadCompany = 'company:read',
  UpdateCompany = 'company:update',
  DeleteCompany = 'company:delete',

  // Users
  CreateUser = 'user:create',
  ReadUser = 'user:read',
  UpdateUser = 'user:update',
  DeleteUser = 'user:delete',
  InviteUser = 'user:invite',
  // Опасные действия — только суперадмин (у трекера их нет).
  Impersonate = 'user:impersonate',   // вход «Глазами» под чужим аккаунтом
  ManageTrackers = 'tracker:manage',  // создание и деактивация трекеров

  // Sprints (stage 2)
  CreateSprint = 'sprint:create',
  ReadSprint = 'sprint:read',
  UpdateSprint = 'sprint:update',

  // Entries (stage 2)
  CreateEntry = 'entry:create',
  ReadEntry = 'entry:read',
  ReadAllEntries = 'entry:read_all',
  UpdateEntry = 'entry:update',
  DeleteEntry = 'entry:delete',
  SubmitReview = 'entry:submit_review',
  TagErrors = 'entry:tag_errors',

  // Error Tags (stage 3)
  ManageTags = 'tag:manage',

  // Analytics (stage 3)
  ViewAnalytics = 'analytics:view',

  // Methodology (stage 4)
  ManageMethodology = 'methodology:manage',

  // Attestation (Release 3 плана «Методичка»): назначает и проверяет тот же, кто ведёт
  // методичку (ManageMethodology) — своё право нужно только менеджеру, чтобы пройти тест.
  TakeAttestation = 'attestation:take',
}
