import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect?: () => void;
  href?: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  dividerBefore?: boolean;
}

export interface DropdownProps {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  items: readonly DropdownItem[];
  align?: 'left' | 'right';
  disabled?: boolean;
  defaultOpen?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
}

export function Dropdown({
  triggerLabel,
  triggerIcon,
  items,
  align = 'left',
  disabled = false,
  defaultOpen = false,
}: DropdownProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const focusEdgeRef = useRef<'first' | 'last'>('first');

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus());
  };

  const updatePosition = () => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const rootStyles = window.getComputedStyle(document.documentElement);
    const inset = Number.parseFloat(rootStyles.getPropertyValue('--chip-space-16'));
    const gap = Number.parseFloat(rootStyles.getPropertyValue('--chip-space-8'));
    if (!Number.isFinite(inset) || !Number.isFinite(gap)) return;
    const preferredLeft = align === 'right' ? triggerRect.right - menuRect.width : triggerRect.left;
    const left = Math.min(
      Math.max(preferredLeft, inset),
      Math.max(inset, window.innerWidth - menuRect.width - inset),
    );
    setPosition({ top: triggerRect.bottom + gap, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [align, open]);

  useEffect(() => {
    if (!open) return;
    const onViewportChange = () => updatePosition();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const focusable = itemRefs.current.filter((item): item is HTMLElement => Boolean(item));
      const target = focusEdgeRef.current === 'last' ? focusable.at(-1) : focusable[0];
      target?.focus();
    });
    return () => window.clearTimeout(timer);
  }, [open]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>, direction: 'next' | 'previous' | 'first' | 'last') => {
    const focusable = itemRefs.current.filter((item): item is HTMLElement => Boolean(item));
    if (!focusable.length) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (direction === 'last') next = focusable.length - 1;
    if (direction === 'next') next = current < 0 ? 0 : (current + 1) % focusable.length;
    if (direction === 'previous') next = current < 0 ? focusable.length - 1 : (current - 1 + focusable.length) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  };

  const menu = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={triggerLabel}
      className="chip-dropdown__menu"
      style={{ top: position.top, left: position.left }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') moveFocus(event, 'next');
        if (event.key === 'ArrowUp') moveFocus(event, 'previous');
        if (event.key === 'Home') moveFocus(event, 'first');
        if (event.key === 'End') moveFocus(event, 'last');
        if (event.key === 'Tab') close();
      }}
    >
      {items.map((item, index) => {
        const content = (
          <>
            {item.icon && <span className="chip-dropdown__icon" aria-hidden="true">{item.icon}</span>}
            <span className="chip-dropdown__label">{item.label}</span>
          </>
        );
        const itemClass = `chip-dropdown__item chip-dropdown__item--${item.tone ?? 'default'}`;
        const setItemRef = (element: HTMLElement | null) => {
          itemRefs.current[index] = item.disabled ? null : element;
        };
        return (
          <div key={`${item.label}-${index}`} className="chip-dropdown__entry">
            {item.dividerBefore && <div role="separator" className="chip-dropdown__separator" />}
            {item.href && !item.disabled ? (
              <a
                ref={setItemRef}
                href={item.href}
                role="menuitem"
                data-chip-control=""
                className={itemClass}
                onClick={() => close()}
              >
                {content}
              </a>
            ) : (
              <button
                ref={setItemRef}
                type="button"
                role="menuitem"
                data-chip-control=""
                className={itemClass}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect?.();
                  close(true);
                }}
              >
                {content}
              </button>
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  ) : null;

  return (
    <span className="chip-dropdown">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        icon={triggerIcon}
        iconRight={<ChevronDown />}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          focusEdgeRef.current = 'first';
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          focusEdgeRef.current = event.key === 'ArrowUp' ? 'last' : 'first';
          setOpen(true);
        }}
      >
        {triggerLabel}
      </Button>
      {menu}
    </span>
  );
}
