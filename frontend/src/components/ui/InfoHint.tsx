import { Info } from 'lucide-react';
import { Button } from '@chirkov/shell';

/**
 * Подсказка при наведении. Иконка «ℹ» рядом с элементом; при hover/focus
 * показывает пояснение. CSS-only (group-hover), без внешних зависимостей —
 * в проекте нет отдельного Tooltip-компонента, а title="" использовать нельзя.
 */
export function InfoHint({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group align-middle">
      <Button
        type="button"
        tabIndex={0}
        aria-label={text}
        variant="ghost"
        size="sm"
        icon={<Info />}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 w-64 -translate-x-1/2 rounded-card bg-inverse-hover px-3 py-2 text-micro text-on-inverse opacity-0 shadow-raised transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
