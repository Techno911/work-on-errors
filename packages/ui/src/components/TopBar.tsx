import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight, Menu } from 'lucide-react';
import { Button } from './Button';

export interface BreadcrumbItem {
  label: string;
  href?: string;
  /** @deprecated Используйте href. */
  path?: string;
}

export interface TopBarProps {
  title: string;
  description?: string;
  breadcrumbs?: readonly BreadcrumbItem[];
  back?: { label?: string; onClick: () => void };
  actions?: ReactNode;
  onOpenMenu?: () => void;
  onNavigate?: (path: string) => void;
}

export function TopBar({ title, description, breadcrumbs = [], back, actions, onOpenMenu, onNavigate }: TopBarProps) {
  const backLabel = back?.label ?? 'Назад';

  return (
    <header className="chip-topbar">
      <div className="chip-topbar__leading">
        {onOpenMenu ? (
          <button type="button" data-chip-control="" className="chip-topbar__menu" onClick={onOpenMenu} aria-label="Открыть меню">
            <Menu aria-hidden="true" />
          </button>
        ) : null}
        <div className="chip-topbar__copy">
          {breadcrumbs.length ? (
            <nav className="chip-breadcrumbs" aria-label="Хлебные крошки">
              {breadcrumbs.map((item, index) => (
                <span key={`${item.href ?? item.path ?? item.label}-${index}`}>
                  {index ? <ChevronRight aria-hidden="true" /> : null}
                  {(item.href ?? item.path) && index < breadcrumbs.length - 1 && onNavigate ? (
                    <button
                      type="button"
                      data-chip-control=""
                      onClick={() => onNavigate((item.href ?? item.path)!)}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span aria-current={index === breadcrumbs.length - 1 ? 'page' : undefined}>{item.label}</span>
                  )}
                </span>
              ))}
            </nav>
          ) : null}
          <div className="chip-topbar__title">
            {back ? (
              <div className="chip-topbar__back">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ArrowLeft />}
                  aria-label={backLabel}
                  onClick={back.onClick}
                >
                  {backLabel}
                </Button>
              </div>
            ) : null}
            <div className="chip-topbar__heading">
              <h1>{title}</h1>
              {description ? <p className="chip-topbar__description">{description}</p> : null}
            </div>
          </div>
        </div>
      </div>
      {actions ? <div className="chip-topbar__actions">{actions}</div> : null}
    </header>
  );
}
