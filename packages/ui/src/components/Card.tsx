import {
  forwardRef,
  type ComponentPropsWithRef,
  type ComponentPropsWithoutRef,
  type ElementType,
  type ReactElement,
  type ReactNode,
} from 'react';

interface CardOwnProps<T extends ElementType> {
  as?: T;
  children?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  surface?: 'surface' | 'canvas';
  radius?: 'card' | 'block';
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  elevation?: 'flat' | 'raised';
  interactive?: boolean;
  className?: string;
}

export type CardProps<T extends ElementType = 'div'> = CardOwnProps<T> & Omit<
  ComponentPropsWithoutRef<T>,
  keyof CardOwnProps<T> | 'style'
>;

type CardRef<T extends ElementType> = ComponentPropsWithRef<T>['ref'];

/** Теги, которые сами по себе нажимаются. Контейнер (div, section, article, li) контролом не
 *  становится оттого, что его передали в `as`: иначе раздел отчёта получает руку и рамку наведения. */
const CONTROL_TAGS = new Set(['a', 'button', 'label', 'summary']);

/** Card — контейнер раскладки, поэтому className разрешён; style закрыт. */
function CardInner<T extends ElementType = 'div'>({
  as,
  className = '',
  children,
  title,
  description,
  action,
  padding = 'md',
  surface = 'surface',
  radius = 'card',
  tone,
  elevation = 'flat',
  interactive = false,
  ...props
}: CardProps<T>, ref: CardRef<T>) {
  const hasHeader = title !== null && title !== undefined || description !== null && description !== undefined;
  const hasContent = children !== null && children !== undefined;
  const Component = as ?? 'div';
  const isControl = interactive || (typeof Component === 'string' ? CONTROL_TAGS.has(Component) : true);
  const nativeProps = Component === 'button' && !('type' in props) ? { ...props, type: 'button' } : props;

  return (
    <Component
      ref={ref}
      {...nativeProps}
      data-chip-control={isControl ? '' : undefined}
      className={[
        'chip-card',
        `chip-card--padding-${padding}`,
        `chip-card--surface-${surface}`,
        `chip-card--radius-${radius}`,
        tone ? `chip-card--tone-${tone}` : '',
        `chip-card--elevation-${elevation}`,
        isControl ? 'chip-card--interactive' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {hasHeader && (
        <div className="chip-card__header" data-has-content={hasContent || undefined}>
          <div className="chip-card__heading">
            {title !== null && title !== undefined && <h3 className="chip-card__title">{title}</h3>}
            {description !== null && description !== undefined && <p className="chip-card__description">{description}</p>}
          </div>
          {action !== null && action !== undefined && <div className="chip-card__action">{action}</div>}
        </div>
      )}
      {children}
    </Component>
  );
}

export const Card = forwardRef(CardInner as never) as unknown as <T extends ElementType = 'div'>(
  props: CardProps<T> & { ref?: CardRef<T> },
) => ReactElement | null;
