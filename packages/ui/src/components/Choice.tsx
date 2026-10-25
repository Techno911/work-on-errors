import { forwardRef, useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { Check, Minus } from 'lucide-react';

type NativeChoiceProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'children' | 'className' | 'size' | 'style' | 'type'
>;

export interface ChoiceProps extends NativeChoiceProps {
  label: ReactNode;
  description?: ReactNode;
}

export interface CheckboxProps extends ChoiceProps {
  indeterminate?: boolean;
}
export type RadioProps = ChoiceProps;

interface ChoiceControlProps extends ChoiceProps {
  choiceType: 'checkbox' | 'radio';
  inputRef: Ref<HTMLInputElement>;
  indeterminate?: boolean;
}

function ChoiceControl({
  choiceType,
  inputRef,
  indeterminate = false,
  label,
  description,
  id,
  disabled,
  'aria-describedby': ariaDescribedBy,
  ...props
}: ChoiceControlProps) {
  const autoId = useId();
  const innerRef = useRef<HTMLInputElement>(null);
  const fieldId = id ?? autoId;
  const descriptionId = description ? `${fieldId}-description` : undefined;

  useEffect(() => {
    if (choiceType === 'checkbox' && innerRef.current) {
      innerRef.current.indeterminate = indeterminate;
    }
  }, [choiceType, indeterminate]);

  const setInputRef = (element: HTMLInputElement | null) => {
    innerRef.current = element;
    if (typeof inputRef === 'function') inputRef(element);
    else if (inputRef) inputRef.current = element;
  };

  return (
    <label className="chip-choice" data-disabled={disabled || undefined} htmlFor={fieldId}>
      <span className="chip-choice__target">
        <input
          {...props}
          ref={setInputRef}
          id={fieldId}
          type={choiceType}
          data-chip-control=""
          disabled={disabled}
          className="chip-choice__input"
          aria-describedby={ariaDescribedBy ?? descriptionId}
          aria-checked={choiceType === 'checkbox' && indeterminate ? 'mixed' : undefined}
        />
        <span className={`chip-choice__visual chip-choice__visual--${choiceType}`} aria-hidden="true">
          {choiceType === 'checkbox' && (indeterminate ? <Minus /> : <Check />)}
        </span>
      </span>
      <span className="chip-choice__copy">
        <span className="chip-choice__label">{label}</span>
        {description && <span id={descriptionId} className="chip-choice__description">{description}</span>}
      </span>
    </label>
  );
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(props, ref) {
  return <ChoiceControl {...props} choiceType="checkbox" inputRef={ref} />;
});

export const Radio = forwardRef<HTMLInputElement, ChoiceProps>(function Radio(props, ref) {
  return <ChoiceControl {...props} choiceType="radio" inputRef={ref} />;
});
