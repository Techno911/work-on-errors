import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpCircle, Lock } from 'lucide-react';
import { AppShell, type NavItemConfig } from '../src';

const nav: NavItemConfig[] = [
  { path: '/home', label: 'Главная' },
  { path: '/clients', label: 'Клиенты' },
  {
    path: '/report',
    label: 'Отчёт',
    children: [
      { path: '/report/losses', label: 'Потери', progress: { completed: 2, total: 5 } },
      { path: '/report/growth', label: 'Рост', progress: { completed: 3, total: 3 } },
    ],
  },
];

function media(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function shell(currentPath = '/home', onNavigate = vi.fn()) {
  return (
    <AppShell
      platformKey="test"
      product="Платформа"
      version="1.2.3"
      navItems={nav}
      currentPath={currentPath}
      user={{ name: 'Демо Пользователь', role: 'Администратор' }}
      onNavigate={onNavigate}
      onLogout={() => {}}
    >
      <p>Содержимое</p>
    </AppShell>
  );
}

describe('AppShell', () => {
  afterEach(cleanup);
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty('--chip-shell-sidebar-width');
  });

  it('восстанавливает сворачивание и синхронизирует CSS-переменную на html', async () => {
    media(false);
    localStorage.setItem('test.sidebar.open', 'false');
    render(shell());
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--chip-shell-sidebar-width')).toContain('collapsed');
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }));
    await waitFor(() => expect(localStorage.getItem('test.sidebar.open')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Свернуть' })).toBeInTheDocument();
  });

  it('закрывает мобильную панель по Esc, подложке, пункту и смене адреса', () => {
    media(true);
    const onNavigate = vi.fn();
    const view = render(shell('/home', onNavigate));
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));
    const panel = screen.getByRole('complementary', { name: 'Главная навигация' });

    open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel).not.toHaveAttribute('data-open');

    open();
    fireEvent.click(screen.getAllByRole('button', { name: 'Закрыть меню' }).at(-1)!);
    expect(panel).not.toHaveAttribute('data-open');

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Клиенты' }));
    expect(onNavigate).toHaveBeenCalledWith('/clients');
    expect(panel).not.toHaveAttribute('data-open');

    open();
    view.rerender(shell('/clients', onNavigate));
    expect(panel).not.toHaveAttribute('data-open');
  });

  it('раскрывает активную группу и показывает прогресс глав', () => {
    media(false);
    const onNavigate = vi.fn();
    render(shell('/report/losses', onNavigate));
    expect(screen.getByRole('group', { name: 'Разделы: Отчёт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Потери/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('Заполнено 2 из 5')).toHaveTextContent('2/5');
    expect(screen.getByLabelText('Заполнено 3 из 3').querySelector('svg')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Свернуть Отчёт' }));
    expect(screen.queryByRole('group', { name: 'Разделы: Отчёт' })).not.toBeInTheDocument();
  });

  it('раскрывает группу, когда активен её собственный маршрут', () => {
    media(false);
    render(shell('/report'));
    expect(screen.getByRole('group', { name: 'Разделы: Отчёт' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отчёт' })).toHaveAttribute('aria-current', 'page');
  });

  it('переопределяет только заголовок, сохраняя активный пункт и крошки', () => {
    media(false);
    render(
      <AppShell
        platformKey="title"
        product="Платформа"
        version="1.2.3"
        title="Разбор потерь за сентябрь"
        navItems={nav}
        currentPath="/report/losses"
        user={{ name: 'Демо Пользователь', role: 'Администратор' }}
        onNavigate={() => undefined}
        onLogout={() => undefined}
      >
        Содержимое
      </AppShell>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Разбор потерь за сентябрь');
    expect(screen.getByRole('button', { name: /^Потери/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('navigation', { name: 'Хлебные крошки' })).toHaveTextContent('ОтчётПотери');
  });

  it('передаёт описание экрана в TopBar под единственным h1', () => {
    media(true);
    render(
      <AppShell
        platformKey="description"
        product="Платформа"
        version="1.2.3"
        title="Проекты"
        description="Все активные исследования команды и их текущий статус"
        navItems={nav}
        currentPath="/home"
        user={{ name: 'Демо Пользователь', role: 'Администратор' }}
        onNavigate={() => undefined}
        onLogout={() => undefined}
      >
        Содержимое
      </AppShell>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Все активные исследования команды и их текущий статус')).toHaveClass(
      'chip-topbar__description',
    );
  });

  it('заменяет автоматические крошки динамическими и ведёт через onNavigate', () => {
    media(false);
    const onNavigate = vi.fn();
    render(
      <AppShell
        platformKey="breadcrumbs"
        product="Платформа"
        version="1.2.3"
        navItems={nav}
        currentPath="/report/losses"
        breadcrumbs={[
          { label: 'Клиенты и пользователи', href: '/clients' },
          { label: 'ООО «Север»', href: '/clients/sever' },
        ]}
        user={{ name: 'Демо Пользователь', role: 'Администратор' }}
        onNavigate={onNavigate}
        onLogout={() => undefined}
      >
        Содержимое
      </AppShell>,
    );

    const crumbs = screen.getByRole('navigation', { name: 'Хлебные крошки' });
    expect(crumbs).toHaveTextContent('Клиенты и пользователиООО «Север»');
    expect(crumbs).not.toHaveTextContent('Отчёт');
    expect(screen.getByText('ООО «Север»')).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'ООО «Север»' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Клиенты и пользователи' }));
    expect(onNavigate).toHaveBeenCalledWith('/clients');
    expect(screen.getByRole('button', { name: /^Потери/ })).toHaveAttribute('aria-current', 'page');
  });

  it('выполняет действие, показывает очередь и не запускает отключённый пункт', () => {
    media(true);
    const onSelect = vi.fn();
    const disabledSelect = vi.fn();
    render(
      <AppShell
        platformKey="actions"
        product="Платформа"
        version="1.2.3"
        navItems={[
          { id: 'help', label: 'Как это работает', icon: HelpCircle, onSelect, count: 3 },
          {
            id: 'locked',
            label: 'Диагностика',
            icon: Lock,
            onSelect: disabledSelect,
            disabled: true,
            disabledReason: 'Откроется после сдачи брифа',
          },
        ]}
        currentPath="/brief"
        user={{ name: 'Демо Пользователь', role: 'Клиент' }}
        onNavigate={() => undefined}
        onLogout={() => undefined}
        sidebarFooter="Точность расчёта 82%"
      >
        Содержимое
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));
    expect(screen.getByText('Точность расчёта 82%')).toHaveClass('chip-shell__sidebar-footer');
    expect(screen.getByLabelText('В очереди 3')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: /^Как это работает/ }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.getByRole('complementary', { name: 'Главная навигация' })).not.toHaveAttribute('data-open');

    fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));
    const disabled = screen.getByRole('button', { name: 'Диагностика' });
    expect(disabled).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(disabled);
    expect(disabledSelect).not.toHaveBeenCalled();
  });

  it('показывает подсказку пункта в свёрнутом меню', async () => {
    media(false);
    localStorage.setItem('collapsed.sidebar.open', 'false');
    render(
      <AppShell
        platformKey="collapsed"
        product="Платформа"
        version="1.2.3"
        navItems={[{ path: '/home', label: 'Главная', icon: HelpCircle }]}
        currentPath="/home"
        user={{ name: 'Демо Пользователь', role: 'Клиент' }}
        onNavigate={() => undefined}
        onLogout={() => undefined}
      >
        Содержимое
      </AppShell>,
    );
    const item = screen.getByRole('button', { name: 'Главная' });
    fireEvent.focus(item);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Главная');
  });
});
