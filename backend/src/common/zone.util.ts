/**
 * Зона выполнения норматива за период.
 * Общий хелпер: используется и в спринтах (прогресс менеджера/команды),
 * и в аналитике (серия регулярности команды).
 */
export type Zone = 'below' | 'good' | 'great';

export function calcZone(count: number, good: number, great: number): Zone {
  if (count >= great) return 'great';
  if (count >= good) return 'good';
  return 'below';
}
