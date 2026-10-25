import { forwardRef, type TextareaHTMLAttributes } from 'react';

type NativeTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className' | 'style'>;

export interface TextareaProps extends NativeTextareaProps {
  invalid?: boolean;
  controlSize?: 'md' | 'sm';
  font?: 'sans' | 'mono';
  resize?: 'vertical' | 'none';
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    invalid = false,
    controlSize = 'md',
    font = 'sans',
    resize = 'vertical',
    'aria-invalid': ariaInvalid,
    ...props
  },
  ref,
) {
  return (
    <textarea
      {...props}
      ref={ref}
      data-chip-control=""
      className={`chip-textarea chip-textarea--${controlSize} chip-textarea--font-${font} chip-textarea--resize-${resize}`}
      aria-invalid={ariaInvalid ?? (invalid || undefined)}
      data-invalid={invalid || undefined}
    />
  );
});
