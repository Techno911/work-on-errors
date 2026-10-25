import {
  Home,
  LayoutDashboard,
  BarChart3,
  Settings,
  BookOpen,
  BookMarked,
  GraduationCap,
} from 'lucide-react';
import type { NavItemConfig } from '@chirkov/shell';

export type Role = 'superadmin' | 'tracker' | 'owner' | 'reviewer' | 'manager';

/**
 * Единый источник состава меню и заголовков страниц (канон оболочки 1.0, §7).
 * Переезд на @chirkov/shell 0.3 (Этап Б, 23.09.2026): тип и правило активного
 * пункта/хлебных крошек теперь пакетные (activeNavPath/navBreadcrumbs/
 * visibleNavItems из '@chirkov/shell'), местных копий не осталось.
 *
 * Трекер (производственный отдел ЧиП) не привязан к компании: ему нужны только список
 * компаний («Главная») и инструкция. Доска спринта, аналитика и настройки — не его контур.
 */
export const navItems: readonly NavItemConfig[] = [
  { path: '/dashboard', icon: Home, label: 'Главная' },
  { path: '/sprint', icon: LayoutDashboard, label: 'Доска спринта', roles: ['superadmin', 'owner', 'reviewer', 'manager'] },
  { path: '/analytics', icon: BarChart3, label: 'Аналитика', roles: ['superadmin', 'owner', 'reviewer'] },
  { path: '/playbook', icon: BookMarked, label: 'Методичка', roles: ['superadmin', 'owner', 'reviewer', 'manager'] },
  { path: '/attestation', icon: GraduationCap, label: 'Аттестация', roles: ['superadmin', 'owner', 'reviewer', 'manager'] },
  { path: '/settings', icon: Settings, label: 'Настройки', roles: ['superadmin', 'owner', 'reviewer', 'manager'] },
  { path: '/manual', icon: BookOpen, label: 'Инструкция' },
];
