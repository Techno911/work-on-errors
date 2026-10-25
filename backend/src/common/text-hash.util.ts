import { createHash } from 'crypto';

/**
 * Хеш версии текста разбора: sha256 сырого UTF8-байтов БЕЗ нормализации.
 * Зеркало в SQL (backfill миграции 8.7.0):
 *   encode(sha256(convert_to("reviewText", 'UTF8')), 'hex')
 * Единственный автор хеша — сервер; клиент получает готовое значение и шлёт его обратно.
 */
export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
