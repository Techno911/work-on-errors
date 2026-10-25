import { clsx, type ClassValue } from 'clsx';
import { twMerge } from './tailwind-merge-config.js';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return `${startDate.toLocaleDateString('ru-RU', opts)} – ${endDate.toLocaleDateString('ru-RU', opts)}`;
}

/** Имя тега ошибки для показа: подчёркивания → пробелы, первая буква заглавная.
 *  В хранении имена остаются как есть — формат только на экране. */
export function formatTagName(name: string): string {
  const s = (name ?? '').replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}


/** Русское склонение: pluralRu(3, 'запись', 'записи', 'записей') → 'записи' */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const d = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}
