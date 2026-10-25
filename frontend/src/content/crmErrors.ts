import { B24_MARKETPLACE_NAME } from './crmPrerequisites';

/** Русские тексты ошибок CRM-интеграции. Код приходит в message ответа API. */
export const CRM_ERROR_TEXTS: Record<string, string> = {
  AUTH_FAILED: 'CRM не принимает токен. Проверьте, что вебхук скопирован целиком и не был удалён в Битрикс24.',
  MARKETPLACE_SUBSCRIPTION_REQUIRED: `Похоже, в Битрикс24 закончилась подписка ${B24_MARKETPLACE_NAME}, без неё CRM не отдаёт данные. Попросите администратора портала продлить её.`,
  RATE_LIMITED: 'Битрикс24 ограничил частоту запросов. Подождите минуту и попробуйте снова.',
  RECORD_NOT_READY: 'Запись ещё обрабатывается в CRM. Попробуйте через пару минут.',
  RECORD_IN_PBX: 'Запись хранится в вашей АТС, а не в CRM. Скачайте её из личного кабинета телефонии и загрузите вручную через «Аудиофайл».',
  LINK_EXPIRED: 'Ссылка на запись устарела: телефония хранит файлы ограниченное время. Скачайте запись из CRM вручную и загрузите через «Аудиофайл».',
  USER_NOT_MAPPED: 'Ваш профиль не сопоставлен с сотрудником CRM. Попросите владельца настроить сопоставление: Настройки → Интеграции.',
  ALREADY_IMPORTED: 'Этот звонок уже добавлен в платформу.',
  STAGED_EXPIRED: 'Выбранная запись звонка устарела: платформа хранит её ограниченное время. Выберите звонок из CRM заново.',
  NETWORK: 'Не удалось связаться с CRM. Проверьте соединение и попробуйте снова.',
  UNKNOWN: 'Что-то пошло не так на стороне CRM. Попробуйте ещё раз или обратитесь в поддержку.',
};

export function crmErrorText(err: unknown): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return (msg && CRM_ERROR_TEXTS[msg]) || CRM_ERROR_TEXTS.UNKNOWN;
}

/** Код ошибки CRM (например, USER_NOT_MAPPED) из ответа API — для ветвления логики в UI. */
export function crmErrorCode(err: unknown): string | null {
  return (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? null;
}
