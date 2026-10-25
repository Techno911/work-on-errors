import type { ComponentType, ReactNode, SVGProps } from 'react';

export interface EmptyStateProps {
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon: Icon, title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className="chip-empty-state" data-compact={compact || undefined}>
      {Icon ? <div className="chip-empty-state__icon"><Icon aria-hidden="true" /></div> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="chip-empty-state__action">{action}</div> : null}
    </div>
  );
}
