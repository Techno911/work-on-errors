import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Доп. классы на внутренний контейнер контента */
  className?: string;
  /** Переопределяет классы затемнения-оверлея (для полноэкранных кейсов вроде лайтбокса) */
  overlayClassName?: string;
  /** Доступное имя диалога (для screen reader'ов) */
  ariaLabel?: string;
  /** id заголовка внутри контента — связывается через aria-labelledby */
  labelledBy?: string;
  /** Закрывать по клику на затемнение. По умолчанию true. */
  closeOnBackdrop?: boolean;
  /** Закрывать по Escape. По умолчанию true. */
  closeOnEscape?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Доступный модальный диалог: portal в body, role="dialog" + aria-modal,
 * focus-trap, закрытие по Escape и клику на затемнение, блокировка скролла body.
 * Внутреннюю разметку и логику оверлея передавайте через children.
 */
export function Modal({
  open,
  onClose,
  children,
  className,
  overlayClassName,
  ariaLabel,
  labelledBy,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: ModalProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Блокировка скролла body, пока диалог открыт
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Фокус внутрь при открытии, возврат фокуса при закрытии
  useEffect(() => {
    if (!open) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const node = contentRef.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? node).focus({ preventScroll: true });
    }
    return () => {
      previouslyFocused.current?.focus?.({ preventScroll: true });
    };
  }, [open]);

  // Escape + focus-trap по Tab
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const node = contentRef.current;
        if (!node) return;
        const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        if (focusable.length === 0) {
          e.preventDefault();
          node.focus({ preventScroll: true });
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus({ preventScroll: true });
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose, closeOnEscape]);

  if (!open) return null;

  return createPortal(
    <div
      className={overlayClassName ?? 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-overlay'}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : ariaLabel}
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={cn('outline-none', className)}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
