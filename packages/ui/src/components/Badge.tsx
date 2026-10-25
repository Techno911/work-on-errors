import type { HTMLAttributes, ReactNode } from 'react';

type NativeBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'className' | 'style'>;

export interface BadgeProps extends NativeBadgeProps {
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  children: ReactNode;
}

export function Badge({ tone = 'neutral', children, ...props }: BadgeProps) {
  return <span {...props} className={`chip-badge chip-badge--${tone}`}>{children}</span>;
}
