import {
  forwardRef,
  type ComponentPropsWithRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
  type MouseEvent,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { buttonClassName, type ButtonVisualProps } from './Button';

type ButtonLinkOwnProps<T extends ElementType> = ButtonVisualProps & {
  as?: T;
  children: ReactNode;
};

export type ButtonLinkProps<T extends ElementType = 'a'> = ButtonLinkOwnProps<T> & Omit<
  ComponentPropsWithoutRef<T>,
  keyof ButtonLinkOwnProps<T> | 'className' | 'style'
>;

type ButtonLinkRef<T extends ElementType> = ComponentPropsWithRef<T>['ref'];

function ButtonLinkInner<T extends ElementType = 'a'>({
  as,
  variant = 'primary',
  size = 'md',
  align,
  icon,
  iconRight,
  fullWidth = false,
  loading,
  children,
  ...props
}: ButtonLinkProps<T>, ref: ButtonLinkRef<T>) {
  const Component = as ?? 'a';
  const originalClick = (props as { onClick?: (event: MouseEvent<HTMLElement>) => void }).onClick;
  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (loading) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    originalClick?.(event);
  };
  return (
    <Component
      {...props}
      ref={ref}
      data-chip-control=""
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
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
    </Component>
  );
}

export const ButtonLink = forwardRef(ButtonLinkInner as never) as unknown as <T extends ElementType = 'a'>(
  props: ButtonLinkProps<T> & { ref?: ButtonLinkRef<T> },
) => ReactElement | null;
