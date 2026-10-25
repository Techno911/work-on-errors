import type { CompanyStatus } from '@/api/admin';
import { Badge } from '@chirkov/shell';

// Единый источник лейблов и цветов статуса компании (бейдж трекера).
// launch — запуск/онбординг; active — работаем; paused — на паузе; closed — архив; demo — не боевой.
type CompanyStatusMeta = {
  label: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  dotColor: string;
};

export const COMPANY_STATUS_META: Record<CompanyStatus, CompanyStatusMeta> = {
  launch: { label: 'Запуск', tone: 'accent', dotColor: 'var(--color-info)' },
  active: { label: 'Активна', tone: 'success', dotColor: 'var(--color-success)' },
  paused: { label: 'На паузе', tone: 'warning', dotColor: 'var(--color-warning)' },
  closed: { label: 'Закрыта', tone: 'neutral', dotColor: 'var(--color-fg-disabled)' },
  demo: { label: 'Демо', tone: 'neutral', dotColor: 'var(--color-on-inverse)' },
};

export const COMPANY_STATUS_ORDER: CompanyStatus[] = ['launch', 'active', 'paused', 'closed', 'demo'];

export function CompanyStatusBadge({ status }: { status: CompanyStatus }) {
  const meta = COMPANY_STATUS_META[status] ?? COMPANY_STATUS_META.launch;
  return (
    <Badge tone={meta.tone}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.dotColor }} />
      {meta.label}
    </Badge>
  );
}
