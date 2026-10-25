import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { PlaybookTrend } from '@/types';
import { Badge } from '@chirkov/shell';

const TREND_CONFIG: Record<PlaybookTrend, { icon: typeof TrendingUp; label: string; color: 'danger' | 'neutral' | 'success' }> = {
  increasing: { icon: TrendingUp, label: 'Учащается', color: 'danger' },
  stable: { icon: Minus, label: 'Стабильно', color: 'neutral' },
  decreasing: { icon: TrendingDown, label: 'Затихает', color: 'success' },
};

interface PlaybookTrendBadgeProps {
  trend: PlaybookTrend;
  occurrenceCount: number;
}

export function PlaybookTrendBadge({ trend, occurrenceCount }: PlaybookTrendBadgeProps) {
  const cfg = TREND_CONFIG[trend];
  const Icon = cfg.icon;
  return (
    <Badge tone={cfg.color}>
      <Icon className="w-3 h-3" />
      {occurrenceCount} раз(а) · {cfg.label}
    </Badge>
  );
}
