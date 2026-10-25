// Абстракция CRM-провайдера: Битрикс24 сейчас, amoCRM — фаза 2 на том же контракте.

export interface CrmConnectionCtx {
  baseUrl: string;
  secret: string; // расшифрованный
}

export interface CrmUser {
  id: string;
  name: string;
  email: string | null;
  // Признак администратора в CRM — единственный структурный сигнал «руководитель»,
  // который CRM отдаёт надёжно. Помогает предложить роль РОПа при импорте команды.
  isAdmin?: boolean;
}

export type RecordingState = 'ready' | 'processing' | 'external_pbx' | 'none';

export interface CrmCall {
  id: string; // crmCallId для дедупликации
  startedAt: string; // ISO
  direction: 'in' | 'out';
  phone: string;
  durationSec: number;
  // processing — звонок завершён, но запись ещё не готова в CRM;
  // external_pbx — запись осталась в АТС, CRM её не получила;
  // none — записи нет (несостоявшийся звонок и т.п.)
  recordingState: RecordingState;
  // Провайдер-специфичные данные для downloadRecording (URL записи, ID файла)
  raw?: unknown;
}

export interface CrmProvider {
  readonly key: 'bitrix24' | 'amocrm';
  /** Проверка доступа: валидный токен + нужные права. Бросает CrmError. */
  testConnection(ctx: CrmConnectionCtx): Promise<{ ok: true; accountName: string }>;
  listUsers(ctx: CrmConnectionCtx): Promise<CrmUser[]>;
  listCalls(ctx: CrmConnectionCtx, crmUserId: string, from: Date, to: Date): Promise<CrmCall[]>;
  /** Скачивает запись стримом на диск. Бросает CrmError (LINK_EXPIRED, RECORD_NOT_READY...). */
  downloadRecording(ctx: CrmConnectionCtx, call: CrmCall, destPath: string): Promise<{ sizeBytes: number }>;
}
