import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { BadgeProps } from './Badge';

type NativeListRowProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'style' | 'title'
>;

interface ListRowBaseProps extends NativeListRowProps {
  statusTone?: NonNullable<BadgeProps['tone']>;
  tone?: 'plain' | 'accent' | 'accent-soft';
  icon?: ReactNode;
}

type StructuredListRowProps = {
  children?: never;
  status: string;
  title: string;
  meta?: string;
};

type CompoundListRowProps = {
  children: ReactNode;
  status?: never;
  title?: never;
  meta?: never;
};

export type ListRowProps = ListRowBaseProps & (StructuredListRowProps | CompoundListRowProps);

export const ListRow = forwardRef<HTMLButtonElement, ListRowProps>(function ListRow(
  {
    status,
    title,
    statusTone = 'neutral',
    tone = 'plain',
    icon,
    meta,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      data-chip-control=""
      className={`chip-list-row chip-list-row--${tone}`}
    >
      {icon && <span className="chip-list-row__icon" aria-hidden="true">{icon}</span>}
      {children === undefined ? (
        <>
          <div className="chip-list-row__copy">
            <span className={`chip-list-row__status chip-list-row__status--${statusTone}`}>{status}</span>
            <span className="chip-list-row__title">{title}</span>
          </div>
          {meta && <span className="chip-list-row__meta">{meta}</span>}
        </>
      ) : <div className="chip-list-row__compound">{children}</div>}
    </button>
  );
});
