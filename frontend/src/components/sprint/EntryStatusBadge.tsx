import type { EntryStatus } from '@/types';
import { Badge } from '@chirkov/shell';

const STATUS_CONFIG = {
  draft: { label: 'Черновик', tone: 'neutral' },
  submitted: { label: 'Ждёт ревью', tone: 'accent' },
  reviewed: { label: 'Проверено', tone: 'success' },
} satisfies Record<EntryStatus, { label: string; tone: 'neutral' | 'accent' | 'success' }>;

interface EntryStatusBadgeProps {
  status: EntryStatus;
}

export function EntryStatusBadge({ status }: EntryStatusBadgeProps) {
  const config = STATUS_CONFIG[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}
