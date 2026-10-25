import { Badge } from '@chirkov/shell';

interface Props {
  level: number;
  title: string;
  emoji: string;
  size?: 'sm' | 'md';
}

const LEVEL_TONE = [
  null,
  'neutral',
  'accent',
  'accent',
  'success',
  'warning',
] as const;

export function LevelBadge({ level, title, emoji }: Props) {
  const tone = LEVEL_TONE[level] ?? LEVEL_TONE[1]!;
  return <Badge tone={tone}>{emoji} {title}</Badge>;
}
