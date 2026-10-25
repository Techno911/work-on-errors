import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';

type NativeButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'>;

export interface ButtonVisualProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
  size?: 'md' | 'sm';
  align?: 'center' | 'start';
  icon?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
  loading?: boolean;
}

export interface ButtonProps extends NativeButtonProps, ButtonVisualProps {}

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  align,
  fullWidth = false,
}: Pick<ButtonVisualProps, 'variant' | 'size' | 'align' | 'fullWidth'>) {
  const widthClass = fullWidth ? ' chip-button--full' : '';
  const resolvedAlign = align ?? (fullWidth ? 'start' : 'center');
  return `chip-button chip-button--${variant} chip-button--${size} chip-button--align-${resolvedAlign}${widthClass}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'primary',
  size = 'md',
  align,
  icon,
  iconRight,
  fullWidth = false,
  loading,
  disabled,
  type = 'button',
  children,
  ...props
}, ref) {
  return (
    <button
      ref={ref}
      {...props}
      type={type}
      data-chip-control=""
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={buttonClassName({ variant, size, align, fullWidth })}
    >
      {icon ? <span className="chip-button__icon" aria-hidden="true">{icon}</span> : null}
      <span className="chip-button__label">{children}</span>
      {iconRight ? <span className="chip-button__icon" aria-hidden="true">{iconRight}</span> : null}
      {loading ? (
        <span className="chip-button__loading" aria-hidden="true">
          <LoaderCircle className="chip-button__spinner" />
        </span>
      ) : null}
    </button>
  );
});
