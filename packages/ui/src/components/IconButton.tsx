import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

type NativeIconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children' | 'className' | 'style'
>;

export interface IconButtonProps extends NativeIconButtonProps {
  'aria-label': string;
  children: ReactNode;
  tone?: 'neutral' | 'danger';
  size?: 'md' | 'sm';
  count?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  children,
  tone = 'neutral',
  size = 'md',
  count,
  type = 'button',
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      {...props}
      type={type}
      data-chip-control=""
      className={`chip-icon-button chip-icon-button--${tone} chip-icon-button--${size}`}
    >
      <span className="chip-icon-button__icon" aria-hidden="true">{children}</span>
      {count && count > 0 ? (
        <span className="chip-icon-button__count" aria-label={`Уведомлений: ${count}`}>
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  );
});
