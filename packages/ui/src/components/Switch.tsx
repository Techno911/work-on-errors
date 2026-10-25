import { forwardRef, useId, type HTMLAttributes, type KeyboardEvent } from 'react';

type NativeSwitchProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  'children' | 'className' | 'onChange' | 'role' | 'style'
>;

export interface SwitchProps extends NativeSwitchProps {
  /** null означает, что решение ещё не принято. */
  value: boolean | null;
  onChange: (value: boolean) => void;
  labels?: readonly [string, string];
  'aria-label': string;
  disabled?: boolean;
}

export const Switch = forwardRef<HTMLDivElement, SwitchProps>(function Switch(
  { value, onChange, labels = ['Да', 'Нет'], disabled = false, ...props },
  ref,
) {
  const groupId = useId();
  const values = [true, false] as const;

  const choose = (index: number) => {
    onChange(values[index]);
    document.getElementById(`${groupId}-${index}`)?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (disabled) return;

    let nextIndex: number | null = null;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = values.length - 1;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index + values.length - 1) % values.length;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % values.length;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    choose(nextIndex);
  };

  return (
    <div
      {...props}
      ref={ref}
      role="radiogroup"
      className="chip-switch"
      aria-disabled={disabled || undefined}
    >
      {values.map((option, index) => {
        const checked = value === option;
        return (
          <button
            key={String(option)}
            id={`${groupId}-${index}`}
            type="button"
            role="radio"
            data-chip-control=""
            aria-checked={checked}
            tabIndex={checked || (value === null && index === 0) ? 0 : -1}
            disabled={disabled}
            className="chip-switch__option"
            onClick={() => onChange(option)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="chip-switch__label">{labels[index]}</span>
          </button>
        );
      })}
    </div>
  );
});
