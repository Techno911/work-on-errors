import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';

export type NoticeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

export interface NoticeProps {
  title: ReactNode;
  children?: ReactNode;
  tone?: NoticeTone;
  action?: ReactNode;
}

const icons = {
  neutral: Info,
  accent: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleX,
};

export function Notice({ title, children, tone = 'neutral', action }: NoticeProps) {
  const Icon = icons[tone];

  return (
    <div className={`chip-notice chip-notice--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon className="chip-notice__icon" aria-hidden="true" />
      <div className="chip-notice__copy">
        <div className="chip-notice__header">
          <div className="chip-notice__title">{title}</div>
          {action ? <div className="chip-notice__action">{action}</div> : null}
        </div>
        {children && <div className="chip-notice__description">{children}</div>}
      </div>
    </div>
  );
}
