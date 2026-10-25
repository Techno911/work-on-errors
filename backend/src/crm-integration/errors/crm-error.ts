export enum CrmErrorCode {
  AUTH_FAILED = 'AUTH_FAILED',
  MARKETPLACE_SUBSCRIPTION_REQUIRED = 'MARKETPLACE_SUBSCRIPTION_REQUIRED',
  RATE_LIMITED = 'RATE_LIMITED',
  RECORD_NOT_READY = 'RECORD_NOT_READY',
  RECORD_IN_PBX = 'RECORD_IN_PBX',
  LINK_EXPIRED = 'LINK_EXPIRED',
  USER_NOT_MAPPED = 'USER_NOT_MAPPED',
  ALREADY_IMPORTED = 'ALREADY_IMPORTED',
  STAGED_EXPIRED = 'STAGED_EXPIRED',
  NETWORK = 'NETWORK',
  UNKNOWN = 'UNKNOWN',
}

/** Ошибка CRM-провайдера с кодом для словаря русских текстов на фронте. */
export class CrmError extends Error {
  constructor(
    public readonly code: CrmErrorCode,
    detail?: string,
  ) {
    // Секреты в detail не попадают: провайдеры передают только статусы и обрезанные тексты ответов
    super(detail ?? code);
  }
}
