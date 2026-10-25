import { describe, expect, it, vi } from 'vitest';
import { activeNavPath, navBreadcrumbs, visibleNavItems, type NavItemConfig } from '../src';

const items: NavItemConfig[] = [
  { path: '/projects', label: 'Проекты' },
  { path: '/projects/current', label: 'Текущий проект', parentPath: '/projects', menu: false },
  { path: '/approvals', label: 'Утверждения', activeMatch: (path) => path.endsWith('/approvals') },
  { path: '/admin', label: 'Админка', roles: ['admin'] },
  {
    path: '/diagnostic',
    label: 'Диагностика',
    children: [
      { path: '/diagnostic/losses', label: 'Где маркетинг теряет деньги', roles: ['client'] },
      { path: '/diagnostic/growth', label: 'Точка Б', roles: ['admin'] },
    ],
  },
];

describe('декларативная навигация', () => {
  it('выбирает самый конкретный префикс', () => {
    expect(activeNavPath(items, '/projects/current/brief')).toBe('/projects/current');
  });

  it('явное правило активности побеждает префикс', () => {
    expect(activeNavPath(items, '/projects/current/approvals')).toBe('/approvals');
  });

  it('строит крошки из того же массива', () => {
    expect(navBreadcrumbs(items, '/projects/current').map((item) => item.label)).toEqual([
      'Проекты', 'Текущий проект',
    ]);
  });

  it('фильтрует состав полем ролей', () => {
    expect(visibleNavItems(items, 'client').some((item) => item.path === '/admin')).toBe(false);
    expect(visibleNavItems(items, 'admin').some((item) => item.path === '/admin')).toBe(true);
  });

  it('находит активную главу внутри группы и строит крошки по структуре', () => {
    expect(activeNavPath(items, '/diagnostic/losses/details')).toBe('/diagnostic/losses');
    expect(navBreadcrumbs(items, '/diagnostic/losses').map((item) => item.label)).toEqual([
      'Диагностика', 'Где маркетинг теряет деньги',
    ]);
    const clientGroup = visibleNavItems(items, 'client').find((item) => item.path === '/diagnostic');
    expect(clientGroup?.children?.map((item) => item.path)).toEqual(['/diagnostic/losses']);
  });

  it('не принимает действие за маршрут и поддерживает его явную активность', () => {
    const action = vi.fn();
    const actionItems: NavItemConfig[] = [
      ...items,
      { id: 'brief-step', label: 'Рынок', onSelect: action, active: true },
    ];
    expect(activeNavPath(actionItems, '/projects')).toBe('brief-step');
    expect(navBreadcrumbs(actionItems, 'brief-step')).toEqual([]);
  });
});
