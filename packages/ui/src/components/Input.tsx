import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'style' | 'size'>;

export interface InputProps extends NativeInputProps {
  invalid?: boolean;
  controlSize?: 'md' | 'sm';
  align?: 'start' | 'end';
  font?: 'sans' | 'mono';
  leadingIcon?: ReactNode;
  trailingText?: string;
  trailingAction?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    invalid = false,
    controlSize = 'md',
    align = 'start',
    font = 'sans',
    leadingIcon,
    trailingText,
    trailingAction,
    type = 'text',
    disabled,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
    ...props
  },
  ref,
) {
  const password = type === 'password';
  const [passwordVisible, setPasswordVisible] = useState(false);
  const trailingId = useId();
  const describedBy = [ariaDescribedBy, trailingText ? trailingId : undefined].filter(Boolean).join(' ') || undefined;
  const input = (
    <input
      {...props}
      ref={ref}
      type={password && passwordVisible ? 'text' : type}
      data-chip-control=""
      disabled={disabled}
      className={[
        'chip-input',
        `chip-input--${controlSize}`,
        `chip-input--align-${align}`,
        `chip-input--font-${font}`,
        leadingIcon ? 'chip-input--leading' : '',
        trailingText ? 'chip-input--trailing' : '',
        trailingAction ? 'chip-input--action' : '',
        password ? 'chip-input--password' : '',
      ].filter(Boolean).join(' ')}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      aria-describedby={describedBy}
      data-invalid={invalid || undefined}
    />
  );

  if (!leadingIcon && !password && !trailingText && !trailingAction) return input;

  return (
    <span
      className={[
        'chip-input-wrap',
        `chip-input-wrap--${controlSize}`,
        password ? 'chip-input-wrap--password' : '',
        trailingText ? 'chip-input-wrap--trailing' : '',
        trailingAction ? 'chip-input-wrap--action' : '',
      ].filter(Boolean).join(' ')}
    >
      {leadingIcon && <span className="chip-input__leading" aria-hidden="true">{leadingIcon}</span>}
      {input}
      {trailingText && <span id={trailingId} className="chip-input__trailing">{trailingText}</span>}
      {trailingAction && <span className="chip-input__action">{trailingAction}</span>}
      {password && (
        <button
          type="button"
          data-chip-control=""
          className="chip-input__password-toggle"
          aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
          aria-pressed={passwordVisible}
          disabled={disabled}
          onClick={() => setPasswordVisible((visible) => !visible)}
        >
          {passwordVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      )}
    </span>
  );
});
