import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

type NativeSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'style' | 'size'>;

export interface SelectProps extends NativeSelectProps {
  invalid?: boolean;
  controlSize?: 'md' | 'sm';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, controlSize = 'md', 'aria-invalid': ariaInvalid, children, ...props },
  ref,
) {
  return (
    <span className={`chip-select chip-select--${controlSize}`} data-invalid={invalid || undefined}>
      <select {...props} ref={ref} data-chip-control="" aria-invalid={ariaInvalid ?? (invalid || undefined)}>
        {children}
      </select>
      <ChevronDown aria-hidden="true" />
    </span>
  );
});
