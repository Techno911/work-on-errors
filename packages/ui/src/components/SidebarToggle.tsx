import { ChevronLeft } from 'lucide-react';

export interface SidebarToggleProps {
  expanded: boolean;
  onToggle: () => void;
}

export function SidebarToggle({ expanded, onToggle }: SidebarToggleProps) {
  const label = expanded ? 'Свернуть' : 'Развернуть';
  return (
    <button
      type="button"
      data-chip-control=""
      className="chip-sidebar-toggle"
      data-expanded={expanded || undefined}
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      <ChevronLeft aria-hidden="true" />
      {expanded ? <span>{label}</span> : null}
    </button>
  );
}
