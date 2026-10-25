import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Label                                                             */
/* ------------------------------------------------------------------ */

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

export function Label({ className, children, required, ...props }: LabelProps) {
  return (
    <label
      className={cn('block text-body font-medium text-fg mb-2', className)}
      {...props}
    >
      {children}
      {required && <span className="text-danger ml-0.5">*</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/*  Hint                                                              */
/* ------------------------------------------------------------------ */

interface HintProps extends React.HTMLAttributes<HTMLParagraphElement> {
  error?: boolean;
}

export function Hint({ className, error, children, ...props }: HintProps) {
  return (
    <p
      className={cn(
        'text-micro mt-1.5',
        error ? 'text-danger' : 'text-fg-subtle',
        className
      )}
      {...props}
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  FormField                                                         */
/* ------------------------------------------------------------------ */

interface FormFieldProps {
  label?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  required,
  hint,
  error,
  htmlFor,
  children,
  className,
}: FormFieldProps) {
  return (
    <div className={cn('', className)}>
      {label && (
        <Label htmlFor={htmlFor} required={required}>
          {label}
        </Label>
      )}
      {children}
      {(error || hint) && <Hint error={!!error}>{error ?? hint}</Hint>}
    </div>
  );
}
