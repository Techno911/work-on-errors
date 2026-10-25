import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';

type TooltipTrigger = ReactElement<{ 'aria-describedby'?: string }>;

export interface TooltipProps {
  text: string;
  children: TooltipTrigger;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
  disabled?: boolean;
}

export function Tooltip({
  text,
  children,
  position = 'top',
  delay = 300,
  disabled = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [coordinates, setCoordinates] = useState({ left: 0, top: 0 });

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const rawGap = getComputedStyle(document.documentElement).getPropertyValue('--chip-space-8');
    const gap = Number.parseFloat(rawGap) || 0;
    if (position === 'top') setCoordinates({ left: rect.left + rect.width / 2, top: rect.top - gap });
    if (position === 'bottom') setCoordinates({ left: rect.left + rect.width / 2, top: rect.bottom + gap });
    if (position === 'left') setCoordinates({ left: rect.left - gap, top: rect.top + rect.height / 2 });
    if (position === 'right') setCoordinates({ left: rect.right + gap, top: rect.top + rect.height / 2 });
  };

  const show = () => {
    if (disabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, delay);
  };

  const hide = () => {
    clearTimer();
    setVisible(false);
  };

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!visible) return;
    const update = () => updatePosition();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [visible, position]);

  const describedBy = [children.props['aria-describedby'], visible ? tooltipId : null]
    .filter(Boolean)
    .join(' ') || undefined;
  const trigger = cloneElement(children, { 'aria-describedby': describedBy });

  return (
    <span
      ref={triggerRef}
      className="chip-tooltip"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
      onKeyDown={(event) => {
        if (event.key === 'Escape') hide();
      }}
    >
      {trigger}
      {visible && typeof document !== 'undefined' ? createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="chip-tooltip__bubble"
          data-position={position}
          style={{ left: coordinates.left, top: coordinates.top }}
        >
          {text}
        </span>,
        document.body,
      ) : null}
    </span>
  );
}
