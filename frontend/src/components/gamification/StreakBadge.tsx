import { Badge } from '@chirkov/shell';

interface Props {
  streak: number;
  size?: 'sm' | 'md';
}
export function StreakBadge({ streak, size = 'md' }: Props) {
  if (streak === 0) return null;
  const active = streak > 0;
  const weeksWord = streak === 1 ? 'неделя' : streak < 5 ? 'недели' : 'недель';
  const ariaLabel = active
    ? `Серия: ${streak} ${weeksWord} подряд`
    : 'Серия прервана';
  if (size === 'sm') return (
    <span className={`inline-flex items-center gap-0.5 text-micro font-semibold ${active ? 'text-accent-hover' : 'text-fg-subtle'}`}>
      <span role="img" aria-label={active ? 'серия активна' : 'серия прервана'}>{active ? '🔥' : '💤'}</span> {streak}
    </span>
  );
  return (
    <Badge tone={active ? 'accent' : 'neutral'} role="img" aria-label={ariaLabel}>
      <span aria-hidden="true">{active ? '🔥' : '💤'}</span>
      <span>{streak} {weeksWord} подряд</span>
    </Badge>
  );
}
