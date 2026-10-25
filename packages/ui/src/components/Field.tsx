import {
  Children,
  cloneElement,
  useId,
  type AriaAttributes,
  type ReactElement,
} from 'react';

interface FieldControlProps {
  id?: string;
  required?: boolean;
  invalid?: boolean;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  'aria-describedby'?: string;
}

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<FieldControlProps>;
}

function joinIds(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ') || undefined;
}

export function Field({ label, hint, error, required = false, children }: FieldProps) {
  const generatedId = useId();
  const control = Children.only(children);
  const controlId = control.props.id ?? `chip-field-${generatedId}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = joinIds(control.props['aria-describedby'], hintId, errorId);

  return (
    <div className="chip-field" data-invalid={Boolean(error) || undefined}>
      <label className="chip-field__label" htmlFor={controlId}>
        {label}
        {required ? <span className="chip-field__required" aria-hidden="true">*</span> : null}
      </label>
      {cloneElement(control, {
        id: controlId,
        required: required || control.props.required || undefined,
        invalid: Boolean(error) || control.props.invalid || undefined,
        'aria-invalid': error ? true : control.props['aria-invalid'],
        'aria-describedby': describedBy,
      })}
      {hint ? <p id={hintId} className="chip-field__hint">{hint}</p> : null}
      {error ? <p id={errorId} className="chip-field__error" role="alert">{error}</p> : null}
    </div>
  );
}
