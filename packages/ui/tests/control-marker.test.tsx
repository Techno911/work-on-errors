import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, type AnchorHTMLAttributes } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppShell, Button, ButtonLink, Card, Checkbox, Chip, DateField, Dropdown, FileField, IconButton, Input,
  ListRow, Modal, Radio, Select, Switch, Table, Tabs, Textarea, Tooltip, TopBar, UserBlock, toast,
} from '../src';

const controlSelector = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(',');

function expectAllControlsMarked() {
  const controls = [...new Set(document.querySelectorAll<HTMLElement>(controlSelector))];
  expect(controls.length).toBeGreaterThan(0);
  const unmarked = controls
    .filter((control) => !control.hasAttribute('data-chip-control'))
    .map((control) => `${control.tagName.toLowerCase()}.${control.className}`);
  expect(unmarked).toEqual([]);
}

const RouterLink = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }>(
  function RouterLink({ to, ...props }, ref) {
    return <a {...props} ref={ref} href={to} />;
  },
);

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

describe('метка контролов пакета', () => {
  afterEach(() => {
    toast.dismiss();
    cleanup();
  });
  beforeEach(() => media(false));

  it('ставит data-chip-control на все экспортируемые интерактивные состояния', async () => {
    const file = new File(['demo'], 'demo.txt', { type: 'text/plain' });
    render(
      <>
        <Button>Кнопка</Button>
        <ButtonLink href="/native">Ссылка</ButtonLink>
        <ButtonLink as={RouterLink} to="/router">Маршрут</ButtonLink>
        <IconButton aria-label="Настройки"><span>⚙</span></IconButton>
        <Card as="a" href="/card-link">Карточка-ссылка</Card>
        <Card as="button">Карточка-кнопка</Card>
        <Checkbox label="Флажок" />
        <Radio label="Радио" />
        <Chip pressed={false} onPressedChange={() => undefined}>Фильтр</Chip>
        <Input aria-label="Пароль" type="password" />
        <Textarea aria-label="Комментарий" />
        <Select aria-label="Выбор"><option>Один</option></Select>
        <DateField label="Дата" value="" onChange={() => undefined} minYear={2023} maxYear={2027} />
        <Switch aria-label="Решение" value onChange={() => undefined} />
        <ListRow status="Статус" title="Строка" />
        <Table
          caption="Строки"
          rows={[{ id: 'row' }]}
          rowKey={(row) => row.id}
          columns={[{ key: 'id', header: 'ID', render: (row) => row.id }]}
          mobile="cards"
          empty="Строк пока нет"
          rowAction={{ label: () => 'Открыть строку', onSelect: () => undefined }}
        />
        <FileField label="Файл" file={file} onFileChange={() => undefined} />
        <Dropdown
          triggerLabel="Действия"
          defaultOpen
          items={[
            { label: 'Открыть', href: '/open' },
            { label: 'Удалить', onSelect: () => undefined },
            { label: 'Недоступно', disabled: true },
          ]}
        />
        <Tabs value="one" onValueChange={() => undefined}>
          <Tabs.List ariaLabel="Вкладки"><Tabs.Tab value="one">Одна</Tabs.Tab></Tabs.List>
          <Tabs.Panel value="one">Содержимое</Tabs.Panel>
        </Tabs>
        <Tooltip text="Подсказка"><Button>Навести</Button></Tooltip>
        <TopBar
          title="Заголовок"
          breadcrumbs={[{ label: 'Раздел', path: '/section' }, { label: 'Экран' }]}
          onNavigate={() => undefined}
          onOpenMenu={() => undefined}
        />
        <UserBlock
          name="Анна Маркова"
          role="Редактор"
          product="Платформа"
          version="1.2.3"
          actions={[{ label: 'Помощь', onClick: () => undefined }]}
          onLogout={() => undefined}
        />
        <AppShell
          platformKey="control-marker"
          product="Платформа"
          version="1.2.3"
          navItems={[{ path: '/group', label: 'Группа', children: [{ path: '/group/child', label: 'Глава' }] }]}
          currentPath="/group"
          user={{ name: 'Анна Маркова', role: 'Редактор' }}
          onNavigate={() => undefined}
          onLogout={() => undefined}
        >
          Содержимое
        </AppShell>
        <Modal open title="Диалог" onClose={() => undefined}><Input aria-label="Поле диалога" /></Modal>
      </>,
    );
    toast('Уведомление', {
      duration: Infinity,
      action: { label: 'Повторить', onClick: () => undefined },
      cancel: { label: 'Отмена', onClick: () => undefined },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Повторить' })).toHaveAttribute('data-chip-control'));
    expectAllControlsMarked();
  });

  it('помечает мобильные кнопки открытия, закрытия и подложки AppShell', () => {
    media(true);
    render(
      <AppShell
        platformKey="control-marker-mobile"
        product="Платформа"
        version="1.2.3"
        navItems={[{ path: '/home', label: 'Главная' }]}
        currentPath="/home"
        user={{ name: 'Анна Маркова', role: 'Редактор' }}
        onNavigate={() => undefined}
        onLogout={() => undefined}
      >
        Содержимое
      </AppShell>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Открыть меню' }));
    expectAllControlsMarked();
  });
});

// 24.09.2026: Card считал контролом любую карточку с `as`, и контейнер `as="section"` или обёртка
// платформы `as ?? 'div'` получали курсор-руку и оранжевую рамку при наведении, хотя нажать там
// нечего. Так на Бренд-платформе стали «нажимаемыми» все карточки раздела, на Точке шесть разделов отчёта.
describe('Card: контейнерный тег не делает карточку контролом', () => {
  afterEach(() => cleanup());

  it.each(['div', 'section', 'article', 'aside', 'li'] as const)('as="%s" без interactive не несёт метку и класс контрола', (tag) => {
    const { container } = render(tag === 'li' ? <ul><Card as={tag}>Содержимое</Card></ul> : <Card as={tag}>Содержимое</Card>);
    const card = container.querySelector('.chip-card')!;
    expect(card.tagName.toLowerCase()).toBe(tag);
    expect(card.hasAttribute('data-chip-control')).toBe(false);
    expect(card.classList.contains('chip-card--interactive')).toBe(false);
  });

  it('ссылка, кнопка, компонент маршрутизатора и явный interactive остаются контролами', () => {
    const { container } = render(
      <>
        <Card as="a" href="/a">Ссылка</Card>
        <Card as="button">Кнопка</Card>
        <Card as={RouterLink} to="/r">Маршрут</Card>
        <Card as="section" interactive>Раздел с обработчиком</Card>
      </>,
    );
    const cards = [...container.querySelectorAll('.chip-card')];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.hasAttribute('data-chip-control')).toBe(true);
      expect(card.classList.contains('chip-card--interactive')).toBe(true);
    }
  });
});
