import type { ReactNode } from 'react';
import { pluralRu } from '@/lib/utils';

type StaffSummaryClassName =
  | 'text-micro text-fg-subtle flex-shrink-0'
  | 'ml-auto text-micro text-fg-subtle flex-shrink-0'
  | 'text-body text-fg-subtle';

// Сводка по составу пространства: менеджеры + РОП + владельцы, каждый с правильными окончаниями.
// Роли считаются раздельно (владелец ≠ РОП). Если РОПа нет (уволился / ещё не назначен) —
// явный янтарный сигнал, а не «0 РОП». Владельцев показываем всегда (0 = ещё не принял оферту).
export function StaffSummary({
  managers,
  reviewers,
  owners,
  className,
}: {
  managers: number;
  reviewers: number;
  owners?: number;
  className?: StaffSummaryClassName;
}) {
  const parts: ReactNode[] = [
    `${managers} ${pluralRu(managers, 'менеджер', 'менеджера', 'менеджеров')}`,
    reviewers > 0
      ? `${reviewers} ${pluralRu(reviewers, 'РОП', 'РОПа', 'РОПов')}`
      : <span className="text-warning-fg font-medium">РОП не назначен</span>,
  ];
  if (owners !== undefined) parts.push(`${owners} ${pluralRu(owners, 'владелец', 'владельца', 'владельцев')}`);

  return (
    <span className={
      className === 'text-micro text-fg-subtle flex-shrink-0'
        ? 'inline-flex flex-wrap items-center gap-x-1.5 text-micro text-fg-subtle flex-shrink-0'
        : className === 'ml-auto text-micro text-fg-subtle flex-shrink-0'
          ? 'inline-flex flex-wrap items-center gap-x-1.5 ml-auto text-micro text-fg-subtle flex-shrink-0'
          : className === 'text-body text-fg-subtle'
            ? 'inline-flex flex-wrap items-center gap-x-1.5 text-body text-fg-subtle'
            : 'inline-flex flex-wrap items-center gap-x-1.5'
    }>
      {parts.map((part, i) => (
        <span key={i} className="whitespace-nowrap">
          {part}
          {i < parts.length - 1 && <span className="text-border"> ·</span>}
        </span>
      ))}
    </span>
  );
}
