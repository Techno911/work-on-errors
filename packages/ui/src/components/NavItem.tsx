import { Check, ChevronDown } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Tooltip } from './Tooltip';

export type NavIcon = ComponentType<SVGProps<SVGSVGElement>>;

export interface NavItemProgress {
  completed: number;
  total: number;
}

interface NavItemBase {
  label: string;
  icon?: NavIcon;
  roles?: readonly string[];
  parentPath?: string;
  menu?: boolean;
  activeMatch?: (pathname: string) => boolean;
  active?: boolean;
  children?: readonly NavItemConfig[];
  progress?: NavItemProgress;
  count?: number;
  disabled?: boolean;
  disabledReason?: string;
}

export type NavItemConfig = NavItemBase & (
  | { path: string; id?: string; onSelect?: never }
  | { id: string; path?: never; onSelect: () => void }
);

export function navItemKey(item: NavItemConfig): string {
  return item.path ?? item.id;
}

export function flattenNavItems(items: readonly NavItemConfig[]): NavItemConfig[] {
  return items.flatMap((item) => [item, ...flattenNavItems(item.children ?? [])]);
}

/** Явное правило побеждает префикс, затем побеждает самый длинный путь. */
export function activeNavPath(items: readonly NavItemConfig[], pathname: string): string | null {
  let winner: { path: string; score: number } | null = null;
  for (const item of flattenNavItems(items)) {
    const key = navItemKey(item);
    const explicit = item.active || Boolean(item.activeMatch);
    const matched = item.active
      || (item.activeMatch ? item.activeMatch(pathname) : Boolean(
        item.path && (pathname === item.path || pathname.startsWith(`${item.path}/`)),
      ));
    const score = explicit ? 100_000 + key.length : key.length;
    if (matched && (!winner || score > winner.score)) winner = { path: key, score };
  }
  return winner?.path ?? null;
}

export function visibleNavItems(items: readonly NavItemConfig[], role?: string): NavItemConfig[] {
  return items
    .filter((item) => !item.roles?.length || (role ? item.roles.includes(role) : false))
    .map((item) => ({
      ...item,
      children: item.children ? visibleNavItems(item.children, role) : undefined,
    }));
}

export function navBreadcrumbs(items: readonly NavItemConfig[], activePath: string | null) {
  if (!activePath) return [];
  const flat = flattenNavItems(items);
  const byPath = new Map(flat.map((item) => [navItemKey(item), item]));
  const structuralParents = new Map<string, string>();
  const indexParents = (entries: readonly NavItemConfig[]) => {
    for (const entry of entries) {
      for (const child of entry.children ?? []) structuralParents.set(navItemKey(child), navItemKey(entry));
      indexParents(entry.children ?? []);
    }
  };
  indexParents(items);
  const result: NavItemConfig[] = [];
  const visited = new Set<string>();
  let current = byPath.get(activePath);
  while (current && !visited.has(navItemKey(current))) {
    result.unshift(current);
    visited.add(navItemKey(current));
    const parentPath = current.parentPath ?? structuralParents.get(navItemKey(current));
    current = parentPath ? byPath.get(parentPath) : undefined;
  }
  return result.length > 1 ? result : [];
}

export interface NavItemProps {
  item: NavItemConfig;
  active?: boolean;
  collapsed?: boolean;
  depth?: number;
  onNavigate: (path: string) => void;
  onSelect?: (item: NavItemConfig) => void;
}

export function NavItem({ item, active = false, collapsed = false, depth = 0, onNavigate, onSelect }: NavItemProps) {
  const Icon = item.icon;
  const progress = item.progress;
  const progressComplete = Boolean(progress && progress.total > 0 && progress.completed >= progress.total);
  const progressLabel = progress ? `${progress.completed} из ${progress.total}` : undefined;
  const countLabel = item.count === undefined ? undefined : `В очереди ${item.count}`;
  const hint = [item.label, countLabel, item.disabledReason].filter(Boolean).join(', ');
  const button = (
    <button
      type="button"
      data-chip-control=""
      className="chip-nav-item"
      data-active={active || undefined}
      data-collapsed={collapsed || undefined}
      data-depth={depth || undefined}
      aria-current={active ? 'page' : undefined}
      aria-disabled={item.disabled || undefined}
      aria-label={collapsed ? [item.label, progressLabel, countLabel, item.disabledReason].filter(Boolean).join(', ') : undefined}
      onClick={() => {
        if (item.disabled) return;
        if (item.path) onNavigate(item.path);
        else if (onSelect) onSelect(item);
        else item.onSelect?.();
      }}
    >
      {Icon ? <Icon className="chip-nav-item__icon" aria-hidden="true" /> : null}
      {collapsed ? null : (
        <span className="chip-nav-item__content">
          <span className="chip-nav-item__label">{item.label}</span>
          {item.count === undefined ? null : (
            <span className="chip-nav-item__count" aria-label={countLabel}>{item.count}</span>
          )}
          {progress ? (
            <span className="chip-nav-item__progress" aria-label={`Заполнено ${progressLabel}`}>
              {progressComplete ? <Check aria-hidden="true" /> : <span>{progress.completed}/{progress.total}</span>}
            </span>
          ) : null}
        </span>
      )}
    </button>
  );
  return collapsed || (item.disabled && item.disabledReason) ? (
    <Tooltip text={hint} position="right">{button}</Tooltip>
  ) : button;
}

export interface NavGroupProps {
  item: NavItemConfig;
  activePath: string | null;
  collapsed?: boolean;
  expanded: boolean;
  depth?: number;
  onNavigate: (path: string) => void;
  onSelect?: (item: NavItemConfig) => void;
  onToggle: () => void;
}

export function NavGroup({
  item,
  activePath,
  collapsed = false,
  expanded,
  depth = 0,
  onNavigate,
  onSelect,
  onToggle,
}: NavGroupProps) {
  const children = item.children?.filter((child) => child.menu !== false) ?? [];
  const descendantPaths = new Set(flattenNavItems(children).map(navItemKey));
  const containsActive = activePath ? descendantPaths.has(activePath) : false;

  if (collapsed) {
    return (
      <NavItem
        item={item}
        active={navItemKey(item) === activePath || containsActive}
        collapsed
        depth={depth}
        onNavigate={onNavigate}
        onSelect={onSelect}
      />
    );
  }

  return (
    <div className="chip-nav-group" data-expanded={expanded || undefined} data-active={containsActive || undefined}>
      <div className="chip-nav-group__row">
        <NavItem
          item={item}
          active={navItemKey(item) === activePath}
          depth={depth}
          onNavigate={onNavigate}
          onSelect={onSelect}
        />
        <button
          type="button"
          data-chip-control=""
          className="chip-nav-group__toggle"
          aria-expanded={expanded}
          aria-label={expanded ? `Свернуть ${item.label}` : `Развернуть ${item.label}`}
          onClick={onToggle}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </div>
      {expanded ? (
        <div className="chip-nav-group__children" role="group" aria-label={`Разделы: ${item.label}`}>
          {children.map((child) => child.children?.length ? (
            <NavGroup
              key={navItemKey(child)}
              item={child}
              activePath={activePath}
              expanded
              depth={depth + 1}
              onNavigate={onNavigate}
              onSelect={onSelect}
              onToggle={() => undefined}
            />
          ) : (
            <NavItem
              key={navItemKey(child)}
              item={child}
              active={navItemKey(child) === activePath}
              depth={depth + 1}
              onNavigate={onNavigate}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
