import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { BrandLogo, BrandMark } from './Brand';
import {
  NavGroup, NavItem, activeNavPath, flattenNavItems, navBreadcrumbs, visibleNavItems,
  navItemKey, type NavItemConfig,
} from './NavItem';
import { SidebarToggle } from './SidebarToggle';
import { TopBar, type BreadcrumbItem } from './TopBar';
import { Toaster } from './Toaster';
import { UserBlock, type UserAction } from './UserBlock';
import type { VersionNumber } from '../version';

function readExpanded(key: string) {
  try {
    const saved = localStorage.getItem(key);
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const rawBreakpoint = getComputedStyle(document.documentElement)
      .getPropertyValue('--chip-breakpoint-mobile');
    const breakpoint = Number.parseFloat(rawBreakpoint);
    const query = window.matchMedia(`(max-width: ${Number.isFinite(breakpoint) ? breakpoint : 0}px)`);
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return mobile;
}

export interface AppShellProps {
  platformKey: string;
  product: string;
  version: VersionNumber;
  company?: string;
  navItems: readonly NavItemConfig[];
  role?: string;
  currentPath: string;
  user: { name: string; role: string; avatarUrl?: string };
  userActions?: readonly UserAction[];
  onNavigate: (path: string) => void;
  onLogout: () => void;
  back?: { label?: string; onClick: () => void };
  actions?: ReactNode;
  sidebarFooter?: ReactNode;
  title?: string;
  description?: string;
  breadcrumbs?: readonly BreadcrumbItem[];
  children: ReactNode;
  className?: string;
}

export function AppShell({
  platformKey,
  product,
  version,
  company = 'Чирков и партнёры',
  navItems,
  role,
  currentPath,
  user,
  userActions,
  onNavigate,
  onLogout,
  back,
  actions,
  sidebarFooter,
  title,
  description,
  breadcrumbs,
  children,
  className = '',
}: AppShellProps) {
  const storageKey = `${platformKey}.sidebar.open`;
  const [expanded, setExpanded] = useState(() => readExpanded(storageKey));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroupPath, setOpenGroupPath] = useState<string | null>(null);
  const mobile = useIsMobile();
  const allowedItems = useMemo(() => visibleNavItems(navItems, role), [navItems, role]);
  const activePath = useMemo(() => activeNavPath(allowedItems, currentPath), [allowedItems, currentPath]);
  const flatItems = useMemo(() => flattenNavItems(allowedItems), [allowedItems]);
  const activeItem = flatItems.find((item) => navItemKey(item) === activePath);
  const automaticBreadcrumbs = navBreadcrumbs(allowedItems, activePath)
    .map((item) => ({ label: item.label, href: item.path }));

  useEffect(() => {
    if (!activePath) return;
    const findGroup = (items: readonly NavItemConfig[]): string | null => {
      for (const item of items) {
        if (item.children?.length && navItemKey(item) === activePath) return navItemKey(item);
        if (flattenNavItems(item.children ?? []).some((child) => navItemKey(child) === activePath)) return navItemKey(item);
        const nested = findGroup(item.children ?? []);
        if (nested) return nested;
      }
      return null;
    };
    const groupPath = findGroup(allowedItems);
    if (groupPath) setOpenGroupPath(groupPath);
  }, [activePath, allowedItems]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(expanded));
    } catch {
      // Приватный режим не должен ломать панель.
    }
  }, [expanded, storageKey]);

  useEffect(() => setMobileOpen(false), [currentPath]);

  useEffect(() => {
    if (!mobileOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [mobileOpen]);

  useEffect(() => {
    const property = '--chip-shell-sidebar-width';
    const previous = document.documentElement.style.getPropertyValue(property);
    const width = mobile
      ? '0'
      : `var(--chip-sidebar-width${expanded ? '' : '-collapsed'})`;
    document.documentElement.style.setProperty(property, width);
    return () => {
      if (previous) document.documentElement.style.setProperty(property, previous);
      else document.documentElement.style.removeProperty(property);
    };
  }, [expanded, mobile]);

  const navigate = (path: string) => {
    setMobileOpen(false);
    onNavigate(path);
  };

  const select = (item: NavItemConfig) => {
    setMobileOpen(false);
    if (!item.path) item.onSelect?.();
  };

  const rootClass = ['chip-shell', className].filter(Boolean).join(' ');
  return (
    <div className={rootClass} data-mobile={mobile || undefined} data-expanded={expanded || undefined}>
      <a className="chip-shell__skip" href="#chip-shell-content" data-chip-control="">Перейти к содержимому</a>
      <aside className="chip-shell__sidebar" data-open={mobileOpen || undefined} aria-label="Главная навигация">
        <div className="chip-shell__brand">
          {expanded || mobile ? (
            <BrandLogo product={product} subtitle={company} tone="light" />
          ) : (
            <BrandMark title={`${product}, v${version}`} />
          )}
          {mobile ? (
            <button type="button" data-chip-control="" className="chip-shell__mobile-close" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню">
              <X aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <nav className="chip-shell__nav">
          {allowedItems.filter((item) => item.menu !== false).map((item) => item.children?.length ? (
            <NavGroup
              key={navItemKey(item)}
              item={item}
              activePath={activePath}
              collapsed={!expanded && !mobile}
              expanded={openGroupPath === navItemKey(item)}
              onNavigate={navigate}
              onSelect={select}
              onToggle={() => setOpenGroupPath((current) => current === navItemKey(item) ? null : navItemKey(item))}
            />
          ) : (
            <NavItem
              key={navItemKey(item)}
              item={item}
              active={navItemKey(item) === activePath}
              collapsed={!expanded && !mobile}
              onNavigate={navigate}
              onSelect={select}
            />
          ))}
        </nav>
        {sidebarFooter && (expanded || mobile) ? (
          <div className="chip-shell__sidebar-footer">{sidebarFooter}</div>
        ) : null}
        {mobile ? null : <SidebarToggle expanded={expanded} onToggle={() => setExpanded((value) => !value)} />}
        <UserBlock
          name={user.name}
          role={user.role}
          product={product}
          version={version}
          avatarUrl={user.avatarUrl}
          collapsed={!expanded && !mobile}
          actions={userActions}
          onLogout={onLogout}
        />
      </aside>
      {mobile && mobileOpen ? (
        <button type="button" data-chip-control="" className="chip-shell__backdrop" onClick={() => setMobileOpen(false)} aria-label="Закрыть меню" />
      ) : null}
      <main className="chip-shell__main">
        <TopBar
          title={title ?? activeItem?.label ?? product}
          description={description}
          breadcrumbs={breadcrumbs ?? automaticBreadcrumbs}
          back={back}
          actions={actions}
          onOpenMenu={mobile ? () => setMobileOpen(true) : undefined}
          onNavigate={navigate}
        />
        <div id="chip-shell-content" className="chip-shell__content">{children}</div>
      </main>
      <Toaster />
    </div>
  );
}
