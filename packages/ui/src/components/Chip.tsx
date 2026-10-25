import type { ButtonHTMLAttributes, ReactNode } from 'react';

type NativeChipProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-pressed' | 'children' | 'className' | 'onClick' | 'style'
>;

export interface ChipProps extends NativeChipProps {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
  icon?: ReactNode;
  count?: number;
  tone?: 'neutral' | 'warning';
}

export function Chip({
  pressed,
  onPressedChange,
  children,
  icon,
  count,
  tone = 'neutral',
  disabled,
  type = 'button',
  ...props
}: ChipProps) {
  return (
    <button
      {...props}
      type={type}
      data-chip-control=""
      className={`chip-filter chip-filter--${tone}`}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => onPressedChange(!pressed)}
    >
      {icon ? <span className="chip-filter__icon" aria-hidden="true">{icon}</span> : null}
      <span className="chip-filter__label">{children}</span>
      {count === undefined ? null : <span className="chip-filter__count">{count}</span>}
    </button>
  );
}
