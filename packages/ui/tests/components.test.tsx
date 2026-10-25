import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createRef, useState, type AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { DateFieldProps, VersionNumber } from '../src';
import {
  AppShell, Avatar, Badge, BrandLogo, BrandMark, Button, ButtonLink, Card, Checkbox, Chip, DateField, DocumentSurface, Dropdown,
  Field, FileField, IconButton, Input, ListRow, LoginShell, Modal, Notice, ProgressBar, Radio, Select, Switch,
  Tabs, Textarea, Tooltip,
  TopBar, UserBlock, categoryColor, computeTabScrollEdges,
} from '../src';

afterEach(cleanup);

describe('@chirkov/shell', () => {
  it('требует явный диапазон лет у DateField', () => {
    expectTypeOf<DateFieldProps>().toMatchTypeOf<{ minYear: number; maxYear: number }>();
  });

  it('рендерит точный знак с канонической пропорцией', () => {
    const { container } = render(<BrandMark size={44} />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('width', '44');
    expect(svg).toHaveAttribute('height', '53');
    expect(svg?.querySelector('path')).toHaveAttribute('fill', 'currentColor');
  });

  it('рендерит логотип с ожидаемыми классами и текстами', () => {
    render(<BrandLogo product="Платформа" tone="light" />);
    expect(screen.getByText('Платформа').closest('.chip-brand-logo')).toHaveClass('chip-brand-logo--light');
    expect(screen.getByText('Чирков и партнёры')).toHaveClass('chip-brand-logo__subtitle');
  });

  it('переводит восемь прежних цветов категорий в системную палитру', () => {
    const legacy = ['#EF4444', '#F59E0B', '#F97316', '#8B5CF6', '#EC4899', '#06B6D4', '#10B981', '#6366F1'];
    expect(legacy.map((color) => categoryColor(color).category)).toEqual([2, 3, 2, 8, 1, 6, 5, 8]);
    expect(categoryColor(4)).toEqual({
      backgroundColor: 'var(--chip-color-category-4)',
      textColor: 'var(--chip-color-on-category)',
      category: 4,
      source: 'system',
    });
    expect(categoryColor('--chip-color-category-6').category).toBe(6);
  });

  it('сохраняет незнакомый цвет как данные и требует исключение', () => {
    expect(categoryColor('#123456')).toEqual({
      backgroundColor: '#123456',
      textColor: 'var(--chip-color-on-category)',
      source: 'data',
      dataDsException: 'цвет из данных',
    });
    render(<Avatar name="Демо Пользователь" color="#123456" />);
    expect(screen.getByRole('img', { name: 'Демо Пользователь' })).toHaveAttribute(
      'data-ds-exception',
      'цвет из данных',
    );
  });

  it('показывает инициалы Avatar без картинки и после ошибки загрузки', () => {
    const { rerender } = render(<Avatar name="Анна Маркова" size="sm" />);
    const avatar = screen.getByRole('img', { name: 'Анна Маркова' });
    expect(avatar).toHaveClass('chip-avatar', 'chip-avatar--sm');
    expect(avatar).toHaveTextContent('АМ');

    rerender(<Avatar name="Анна Маркова" src="/missing-avatar.jpg" />);
    fireEvent.error(screen.getByRole('img', { name: 'Анна Маркова' }).querySelector('img')!);
    expect(screen.getByRole('img', { name: 'Анна Маркова' })).toHaveTextContent('АМ');
  });

  it('рендерит Button и Input с закрытыми классами кита', () => {
    render(<><Button fullWidth>Продолжить</Button><Input aria-label="Почта" /></>);
    expect(screen.getByRole('button')).toHaveClass('chip-button', 'chip-button--primary', 'chip-button--full');
    expect(screen.getByLabelText('Почта')).toHaveClass('chip-input');
  });

  it('рендерит IconButton в двух размерах и требует доступное имя', () => {
    render(
      <>
        <IconButton aria-label="Настройки" tone="neutral"><span>Н</span></IconButton>
        <IconButton aria-label="Удалить" tone="danger" size="sm"><span>У</span></IconButton>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Настройки' })).toHaveClass(
      'chip-icon-button--neutral',
      'chip-icon-button--md',
    );
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveClass(
      'chip-icon-button--danger',
      'chip-icon-button--sm',
    );
  });

  it('ограничивает счётчик IconButton значением 99+', () => {
    const { rerender } = render(<IconButton aria-label="Уведомления" count={125}><span>У</span></IconButton>);
    expect(screen.getByLabelText('Уведомлений: 125')).toHaveTextContent('99+');
    rerender(<IconButton aria-label="Уведомления" count={0}><span>У</span></IconButton>);
    expect(screen.queryByText('99+')).not.toBeInTheDocument();
  });

  it('даёт ссылке вид Button и поддерживает замену элемента', () => {
    const RouterLink = ({ to, ...props }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={to} {...props} />
    );
    render(
      <>
        <ButtonLink href="/projects" variant="secondary">К проектам</ButtonLink>
        <ButtonLink as={RouterLink} to="/reports" size="sm">К отчётам</ButtonLink>
      </>,
    );
    expect(screen.getByRole('link', { name: 'К проектам' })).toHaveClass(
      'chip-button',
      'chip-button--secondary',
    );
    expect(screen.getByRole('link', { name: 'К отчётам' })).toHaveAttribute('href', '/reports');
  });

  it('даёт Input левую иконку и встроенный показ пароля', () => {
    render(
      <Input
        aria-label="Пароль"
        type="password"
        leadingIcon={<span data-testid="leading-icon" />}
        defaultValue="secret"
      />,
    );
    const input = screen.getByLabelText('Пароль');
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByTestId('leading-icon').closest('.chip-input__leading')).toHaveAttribute('aria-hidden', 'true');
    const toggle = screen.getByRole('button', { name: 'Показать пароль' });
    fireEvent.click(toggle);
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Скрыть пароль' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('связывает Field с Input, Select и Textarea без местной обёртки', () => {
    render(
      <>
        <Field label="Название" hint="Как в договоре" required><Input /></Field>
        <Field label="Роль"><Select><option>Клиент</option></Select></Field>
        <Field label="Комментарий" hint="До 500 знаков" error="Заполните комментарий">
          <Textarea aria-describedby="external-description" />
        </Field>
      </>,
    );

    const input = screen.getByLabelText(/^Название/);
    const select = screen.getByLabelText('Роль');
    const textarea = screen.getByLabelText('Комментарий');
    expect(input.id).not.toBe('');
    expect(select.id).not.toBe('');
    expect(textarea.id).not.toBe('');
    expect(input).toBeRequired();
    expect(input.getAttribute('aria-describedby')).toContain(screen.getByText('Как в договоре').id);
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea.getAttribute('aria-describedby')).toContain('external-description');
    expect(textarea.getAttribute('aria-describedby')).toContain(screen.getByText('До 500 знаков').id);
    expect(textarea.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
  });

  it('собирает DateField из трёх Select и отдаёт только настоящую ISO-дату', () => {
    function DateHarness() {
      const [value, setValue] = useState('');
      return (
        <>
          <DateField
            label="Дата встречи"
            value={value}
            onChange={setValue}
            minYear={2023}
            maxYear={2024}
            hint="Укажите день, месяц и год"
          />
          <output>{value || 'пусто'}</output>
        </>
      );
    }

    const { container } = render(<DateHarness />);
    const day = screen.getByLabelText('Дата встречи: день');
    const month = screen.getByLabelText('Дата встречи: месяц');
    const year = screen.getByLabelText('Дата встречи: год');
    expect(container.querySelector('input[type="date"]')).not.toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(3);
    expect(within(year).getAllByRole('option')).toHaveLength(3);
    expect(within(month).getByRole('option', { name: 'февраля' })).toBeInTheDocument();

    fireEvent.change(day, { target: { value: '29' } });
    fireEvent.change(month, { target: { value: '02' } });
    fireEvent.change(year, { target: { value: '2024' } });
    expect(screen.getByText('2024-02-29')).toBeInTheDocument();

    fireEvent.change(year, { target: { value: '2023' } });
    expect(screen.getByText('пусто')).toBeInTheDocument();
    expect(day).toHaveValue('');
    expect(within(day).queryByRole('option', { name: '29' })).not.toBeInTheDocument();
  });

  it('не принимает 31 февраля из внешнего значения', () => {
    const { container } = render(
      <DateField label="Дата" value="2024-02-31" onChange={() => undefined} minYear={2024} maxYear={2024} />,
    );
    expect(screen.getByLabelText('Дата: день')).toHaveValue('');
    expect(screen.getByLabelText('Дата: месяц')).toHaveValue('');
    expect(screen.getByLabelText('Дата: год')).toHaveValue('');
    expect(container.querySelector('input')).not.toBeInTheDocument();
  });

  it('сохраняет дату вне диапазона и добавляет её год в список', () => {
    render(
      <DateField label="Срок" value="2028-09-23" onChange={() => undefined} minYear={2023} maxYear={2027} />,
    );
    expect(screen.getByLabelText('Срок: день')).toHaveValue('23');
    expect(screen.getByLabelText('Срок: месяц')).toHaveValue('09');
    const year = screen.getByLabelText('Срок: год');
    expect(year).toHaveValue('2028');
    expect(within(year).getByRole('option', { name: '2028' })).toBeInTheDocument();
  });

  it('связывает правую подпись Input с полем', () => {
    render(<Input aria-label="Срок" trailingText="дней" />);
    const input = screen.getByLabelText('Срок');
    const suffix = screen.getByText('дней');
    expect(input).toHaveClass('chip-input--trailing');
    expect(input.getAttribute('aria-describedby')).toContain(suffix.id);
  });

  it('даёт Input действие справа и моноширинный текст', () => {
    render(
      <Input
        aria-label="Вебхук"
        font="mono"
        trailingAction={<IconButton aria-label="Скопировать" size="sm"><span>К</span></IconButton>}
      />,
    );
    expect(screen.getByLabelText('Вебхук')).toHaveClass('chip-input--font-mono', 'chip-input--action');
    expect(screen.getByRole('button', { name: 'Скопировать' }).closest('.chip-input__action')).toBeInTheDocument();
  });

  it('задаёт Textarea шрифт и режим изменения размера', () => {
    render(<Textarea aria-label="Транскрипт" font="mono" resize="none" />);
    expect(screen.getByLabelText('Транскрипт')).toHaveClass(
      'chip-textarea--font-mono',
      'chip-textarea--resize-none',
    );
  });

  it('выравнивает числовой Input по концу и включает табличные цифры', () => {
    render(<Input aria-label="Сумма" align="end" inputMode="decimal" defaultValue="125000" />);
    expect(screen.getByLabelText('Сумма')).toHaveClass('chip-input--align-end');
  });

  it('синхронизирует частичный Checkbox с native и aria-состоянием', () => {
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(<Checkbox ref={ref} label="Выбрать всех" indeterminate />);
    const checkbox = screen.getByRole('checkbox', { name: 'Выбрать всех' });
    expect(ref.current?.indeterminate).toBe(true);
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed');
    expect(checkbox.nextElementSibling?.querySelector('svg')).toBeInTheDocument();
    rerender(<Checkbox ref={ref} label="Выбрать всех" indeterminate={false} />);
    expect(ref.current?.indeterminate).toBe(false);
    expect(checkbox).not.toHaveAttribute('aria-checked');
  });

  it('создаёт единственную границу документного вида', () => {
    const { container } = render(<DocumentSurface>Отчёт</DocumentSurface>);
    const surface = container.querySelector('[data-chip-doc]');
    expect(surface).toHaveClass('chip-document-surface');
    expect(surface).toHaveTextContent('Отчёт');
  });

  it('задаёт заголовок и описание Card типографикой пакета', () => {
    render(
      <Card
        title="Результат"
        description="Описание карточки"
        action={<Button size="sm">Действие</Button>}
        padding="sm"
        surface="canvas"
        radius="block"
      >
        Содержимое
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Результат', level: 3 })).toHaveClass('chip-card__title');
    expect(screen.getByText('Описание карточки')).toHaveClass('chip-card__description');
    expect(screen.getByRole('button', { name: 'Действие' }).closest('.chip-card__action')).toBeInTheDocument();
    expect(screen.getByText('Содержимое').closest('.chip-card')).toHaveClass(
      'chip-card--padding-sm',
      'chip-card--surface-canvas',
      'chip-card--radius-block',
      'chip-card--elevation-flat',
    );
  });

  it('задаёт Card пятью тонами данных и двумя уровнями', () => {
    render(
      <>
        <Card tone="neutral">neutral</Card>
        <Card tone="accent">accent</Card>
        <Card tone="success">success</Card>
        <Card tone="warning">warning</Card>
        <Card tone="danger" elevation="raised">danger raised</Card>
      </>,
    );
    for (const tone of ['neutral', 'accent', 'success', 'warning'] as const) {
      expect(screen.getByText(tone).closest('.chip-card')).toHaveClass(
        `chip-card--tone-${tone}`,
        'chip-card--elevation-flat',
      );
    }
    expect(screen.getByText('danger raised').closest('.chip-card')).toHaveClass(
      'chip-card--tone-danger',
      'chip-card--elevation-raised',
    );
  });

  it('отдаёт ref и пакетное состояние интерактивной Card', () => {
    const ref = createRef<HTMLDivElement>();
    const onClick = vi.fn();
    render(<Card ref={ref} interactive role="button" tabIndex={0} onClick={onClick}>Открыть компанию</Card>);
    const card = screen.getByRole('button', { name: 'Открыть компанию' });
    expect(ref.current).toBe(card);
    expect(card).toHaveClass('chip-card--interactive');
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('делает Card ссылкой или кнопкой без местной оболочки', () => {
    const RouterCard = ({ to, ...props }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={to} {...props} />
    );
    render(
      <>
        <Card as="a" href="/project">Проект</Card>
        <Card as="button">Создать проект</Card>
        <Card as={RouterCard} to="/router-project">Проект роутера</Card>
      </>,
    );
    expect(screen.getByRole('link', { name: 'Проект' })).toHaveClass('chip-card--interactive');
    expect(screen.getByRole('button', { name: 'Создать проект' })).toHaveAttribute('type', 'button');
    expect(screen.getByRole('link', { name: 'Проект роутера' })).toHaveAttribute('href', '/router-project');
  });

  it('даёт Button независимые левый и правый слоты иконок', () => {
    const { container } = render(
      <Button icon={<span>Л</span>} iconRight={<span>П</span>}>Продолжить</Button>,
    );
    const button = within(container).getByRole('button', { name: 'Продолжить' });
    expect(button.querySelectorAll('.chip-button__icon')).toHaveLength(2);
    expect(button.querySelector('.chip-button__label')).toHaveTextContent('Продолжить');
  });

  it('блокирует Button и ButtonLink в loading без резерва слота в покое', () => {
    const buttonClick = vi.fn();
    const linkClick = vi.fn();
    const { rerender } = render(
      <Button loading={false} onClick={buttonClick}>Сохранить</Button>,
    );
    const idle = screen.getByRole('button', { name: 'Сохранить' });
    expect(idle.querySelector('.chip-button__icon')).not.toBeInTheDocument();
    expect(idle.querySelector('.chip-button__loading')).not.toBeInTheDocument();
    rerender(<Button loading onClick={buttonClick}>Сохранить</Button>);
    const busy = screen.getByRole('button', { name: 'Сохранить' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy).toHaveTextContent('Сохранить');
    expect(busy.querySelector('.chip-button__spinner')).toBeInTheDocument();
    expect(busy.querySelector('.chip-button__loading')).toBeInTheDocument();
    fireEvent.click(busy);
    expect(buttonClick).not.toHaveBeenCalled();

    rerender(<ButtonLink href="/result" loading onClick={linkClick}>Открыть результат</ButtonLink>);
    const link = screen.getByRole('link', { name: 'Открыть результат' });
    expect(link).toHaveAttribute('aria-busy', 'true');
    expect(link).toHaveAttribute('aria-disabled', 'true');
    expect(link).toHaveTextContent('Открыть результат');
    fireEvent.click(link);
    expect(linkClick).not.toHaveBeenCalled();
  });

  it('выравнивает fullWidth Button по началу, если align не задан явно', () => {
    const { rerender } = render(<Button fullWidth iconRight={<span>П</span>}>Настроить профиль</Button>);
    expect(screen.getByRole('button', { name: 'Настроить профиль' })).toHaveClass(
      'chip-button--full',
      'chip-button--align-start',
    );
    rerender(<Button fullWidth align="center">Настроить профиль</Button>);
    expect(screen.getByRole('button', { name: 'Настроить профиль' })).toHaveClass('chip-button--align-center');
  });

  it('переключает Checkbox, Radio и Switch по доступной подписи', () => {
    const checkboxChange = vi.fn();
    const radioChange = vi.fn();
    const switchChange = vi.fn();
    render(
      <>
        <Checkbox label="Запомнить меня" onChange={checkboxChange} />
        <Radio label="Первый вариант" name="choice" onChange={radioChange} />
        <Switch aria-label="Автосохранение" value={false} onChange={switchChange} />
      </>,
    );
    fireEvent.click(screen.getByText('Запомнить меня'));
    fireEvent.click(screen.getByText('Первый вариант'));
    const switchGroup = screen.getByRole('radiogroup', { name: 'Автосохранение' });
    fireEvent.click(within(switchGroup).getByRole('radio', { name: 'Да' }));
    expect(checkboxChange).toHaveBeenCalledOnce();
    expect(radioChange).toHaveBeenCalledOnce();
    expect(switchChange).toHaveBeenCalledWith(true);
  });

  it('переключает сегменты Switch стрелками, Home и End', () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Решение" value={null} onChange={onChange} />);
    const group = screen.getByRole('radiogroup', { name: 'Решение' });
    const yes = within(group).getByRole('radio', { name: 'Да' });
    const no = within(group).getByRole('radio', { name: 'Нет' });

    expect(yes).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(yes, { key: 'ArrowRight' });
    fireEvent.keyDown(no, { key: 'Home' });
    fireEvent.keyDown(yes, { key: 'End' });
    expect(onChange.mock.calls).toEqual([[false], [true], [false]]);
  });

  it('переключает Chip через aria-pressed и показывает счётчик', () => {
    const onPressedChange = vi.fn();
    render(
      <Chip pressed={false} onPressedChange={onPressedChange} count={7} tone="warning">
        Требует внимания
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Требует внимания 7' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).toHaveClass('chip-filter--warning');
    fireEvent.click(chip);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('рисует иконку Chip отдельным слотом слева от подписи', () => {
    const { rerender } = render(
      <Chip pressed={false} onPressedChange={() => undefined} icon={<span data-testid="chip-icon">Т</span>}>
        Тема
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Тема' });
    expect(screen.getByTestId('chip-icon').closest('.chip-filter__icon')).toHaveAttribute('aria-hidden', 'true');
    expect(chip.querySelector('.chip-filter__label')).toHaveTextContent('Тема');
    expect(chip.querySelector('.chip-filter__label svg')).not.toBeInTheDocument();
    rerender(
      <Chip pressed onPressedChange={() => undefined} icon={<span data-testid="chip-icon-selected">Т</span>}>
        Тема
      </Chip>,
    );
    expect(screen.getByRole('button', { name: 'Тема' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('собирает ListRow из статуса и названия без местной вёрстки', () => {
    const onClick = vi.fn();
    render(
      <ListRow
        status="Стадия 2 · готово"
        statusTone="success"
        title="Портрет клиента"
        meta="Сегодня"
        tone="accent"
        onClick={onClick}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Стадия 2.*Портрет клиента.*Сегодня/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText('Стадия 2 · готово')).toHaveClass('chip-list-row__status--success');
  });

  it('делает составное содержимое ListRow одной кнопкой-строкой', () => {
    const onClick = vi.fn();
    render(
      <ListRow onClick={onClick} aria-label="Открыть клиента Север">
        <strong>Север</strong><span>Бриф готов</span><span>Диагностика в работе</span>
      </ListRow>,
    );
    const row = screen.getByRole('button', { name: 'Открыть клиента Север' });
    expect(row.querySelector('.chip-list-row__compound')).toHaveTextContent('СеверБриф готовДиагностика в работе');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('ограничивает ProgressBar диапазоном 0–100', () => {
    render(<ProgressBar value={140} ariaLabel="Готовность" tone="success" showValue />);
    const progress = screen.getByRole('progressbar', { name: 'Готовность' });
    expect(progress).toHaveAttribute('aria-valuenow', '100');
    expect(progress).toHaveAttribute('aria-valuetext', '100%');
    expect(screen.getByText('100%')).toHaveClass('chip-progress__value');
  });

  it('переключает Tabs мышью и стрелками', () => {
    function TabsHarness() {
      const [value, setValue] = useState('overview');
      return (
        <Tabs value={value} onValueChange={setValue}>
          <Tabs.List ariaLabel="Разделы">
            <Tabs.Tab value="overview">Обзор</Tabs.Tab>
            <Tabs.Tab value="document">Документ</Tabs.Tab>
            <Tabs.Tab value="disabled" disabled>Недоступно</Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="overview">Сводка</Tabs.Panel>
          <Tabs.Panel value="document">Текст документа</Tabs.Panel>
        </Tabs>
      );
    }
    render(<TabsHarness />);
    const overview = screen.getByRole('tab', { name: 'Обзор' });
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Документ' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Текст документа');
    expect(computeTabScrollEdges({ scrollWidth: 600, clientWidth: 390, scrollLeft: 0 })).toEqual({
      left: false,
      right: true,
    });
  });

  it('открывает Dropdown как меню и закрывает после выбора', () => {
    const onSelect = vi.fn();
    render(
      <Dropdown
        triggerLabel="Действия"
        items={[
          { label: 'Переименовать', onSelect },
          { label: 'Недоступно', disabled: true },
          { label: 'Удалить', tone: 'danger', dividerBefore: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Действия' }));
    expect(screen.getByRole('menu', { name: 'Действия' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Переименовать' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('показывает доступный Tooltip по фокусу и закрывает по Escape', async () => {
    render(
      <Tooltip text="Подробное объяснение" delay={0}>
        <Button>Навести</Button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Навести' });
    fireEvent.focus(trigger);
    const tooltip = await screen.findByRole('tooltip');
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id);
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('рендерит все тона Notice с каноническими ролями', () => {
    render(
      <Notice title="Ошибка" tone="danger" action={<Button size="sm">Подробнее</Button>}>
        Повторите попытку
      </Notice>,
    );
    expect(screen.getByRole('alert')).toHaveClass('chip-notice', 'chip-notice--danger');
    expect(screen.getByText('Повторите попытку')).toHaveClass('chip-notice__description');
    expect(screen.getByRole('button', { name: 'Подробнее' }).closest('.chip-notice__action')).toBeInTheDocument();
  });

  it('прячет системный file input и отдаёт выбранный файл', () => {
    const onFileChange = vi.fn();
    const { container } = render(
      <FileField label="Добавить файл" file={null} onFileChange={onFileChange} accept=".txt" />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['данные'], 'ответ.txt', { type: 'text/plain' });
    expect(input).toHaveClass('chip-file-field__input');
    fireEvent.change(input!, { target: { files: [file] } });
    expect(onFileChange).toHaveBeenCalledWith(file);
  });

  it('показывает файл с сервера и три действия без системного контрола', () => {
    const onDownload = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <FileField
        label="Договор"
        storedFile={{ name: 'Договор.pdf', size: '1,2 МБ' }}
        onDownload={onDownload}
        onDelete={onDelete}
        onFileChange={() => undefined}
      />,
    );
    expect(screen.getByText('Договор.pdf')).toHaveClass('chip-file-field__stored-name');
    expect(screen.getByText('1,2 МБ')).toHaveClass('chip-file-field__stored-size');
    fireEvent.click(screen.getByRole('button', { name: 'Скачать' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onDownload).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    expect(container.querySelector('input[type="file"]')).toHaveClass('chip-file-field__input');
  });

  it('добавляет и удаляет несколько файлов одним FileField', () => {
    const first = new File(['один'], 'один.txt', { type: 'text/plain' });
    const second = new File(['два'], 'два.txt', { type: 'text/plain' });
    const onFilesChange = vi.fn();
    const { container } = render(
      <FileField label="Материалы" multiple files={[first]} onFilesChange={onFilesChange} />,
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toHaveAttribute('multiple');
    fireEvent.change(input!, { target: { files: [second] } });
    expect(onFilesChange).toHaveBeenCalledWith([first, second]);
    fireEvent.click(screen.getByRole('button', { name: 'Убрать файл один.txt' }));
    expect(onFilesChange).toHaveBeenLastCalledWith([]);
  });

  it('показывает круглый вариант аватара с заменой', () => {
    const { container } = render(
      <FileField
        label="Фото профиля"
        variant="avatar"
        avatarPreview="data:image/jpeg;base64,preview"
        accept="image/*"
      />,
    );
    expect(screen.getByRole('button', { name: 'Заменить фото' })).toBeInTheDocument();
    expect(container.querySelector('.chip-file-field__avatar img')).toBeInTheDocument();
  });

  it('фокусирует первый контрол содержимого Modal и закрывает по Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal
        open
        title="Подтверждение"
        onClose={onClose}
        size="lg"
        headerActions={<Button size="sm">Справка</Button>}
      >
        <Input aria-label="Название компании" />
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Подтверждение' })).toHaveClass('chip-modal--lg');
    expect(screen.getByRole('button', { name: 'Справка' }).closest('.chip-modal__header-actions')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Название компании' })).toHaveFocus());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('отдаёт текстовое действие вариантом Button, а не локальной кнопкой', () => {
    render(<Button variant="link" fullWidth>Вернуться ко входу</Button>);
    expect(screen.getByRole('button', { name: 'Вернуться ко входу' })).toHaveClass(
      'chip-button--link',
      'chip-button--full',
    );
  });

  it('даёт все варианты и размеры без внешних классов', () => {
    render(
      <>
        <Button variant="danger" size="sm">Удалить</Button>
        <Input aria-label="Короткое поле" controlSize="sm" />
        <Textarea aria-label="Комментарий" />
        <Select aria-label="Роль"><option>Клиент</option></Select>
        <Badge tone="warning">Ждёт</Badge>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Удалить' })).toHaveClass('chip-button--danger', 'chip-button--sm');
    expect(screen.getByLabelText('Короткое поле')).toHaveClass('chip-input--sm');
    expect(screen.getByLabelText('Комментарий')).toHaveClass('chip-textarea');
    expect(screen.getByLabelText('Роль').closest('.chip-select')).toBeInTheDocument();
    expect(screen.getByText('Ждёт')).toHaveClass('chip-badge--warning');
  });

  it('сохраняет полную подпись кнопки «Назад» в доступном имени', () => {
    render(<TopBar title="Компоненты" back={{ label: 'К обзору', onClick: () => {} }} />);
    expect(screen.getByRole('button', { name: 'К обзору' })).toHaveAttribute('aria-label', 'К обзору');
  });

  it('держит ровно одну точку выхода в блоке пользователя', () => {
    render(<UserBlock name="Демо Пользователь" role="Администратор" product="Точка" version="1.2.3" onLogout={() => {}} />);
    expect(screen.getAllByRole('button', { name: 'Выйти' })).toHaveLength(1);
    expect(screen.getByText('ДП').closest('.chip-avatar')).toBeInTheDocument();
  });

  it('печатает строку версии последним ребёнком развёрнутого блока в форме «Имя, v1.2.3»', () => {
    const { container } = render(
      <UserBlock name="Демо Пользователь" role="Администратор" product="Точка" version="1.2.3" onLogout={() => {}} />,
    );
    const line = container.querySelector('[data-chip-version]');
    expect(line).toHaveClass('chip-user-block__version');
    expect(line?.textContent).toMatch(/^.+, v\d+\.\d+\.\d+$/);
    expect(line?.textContent).toBe('Точка, v1.2.3');
    expect(container.querySelector('.chip-user-block')?.lastElementChild).toBe(line);
  });

  it('не печатает строку версии в свёрнутом блоке', () => {
    const { container } = render(
      <UserBlock name="Демо Пользователь" role="Администратор" product="Точка" version="1.2.3" collapsed onLogout={() => {}} />,
    );
    expect(container.querySelector('[data-chip-version]')).toBeNull();
    expect(container.textContent).not.toMatch(/v\d+\.\d+\.\d+/);
  });

  it('уносит номер в подсказку знака свёрнутой панели AppShell, а строки в панели нет', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query, onchange: null,
        addEventListener: vi.fn(), removeEventListener: vi.fn(),
        addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
    localStorage.setItem('version-test.sidebar.open', 'false');
    const { container } = render(
      <AppShell
        platformKey="version-test"
        product="Точка"
        version="1.2.3"
        navItems={[{ path: '/home', label: 'Главная' }]}
        currentPath="/home"
        user={{ name: 'Демо Пользователь', role: 'Администратор' }}
        onNavigate={() => {}}
        onLogout={() => {}}
      >
        <p>Содержимое</p>
      </AppShell>,
    );
    expect(container.querySelector('.chip-shell__brand svg title')?.textContent).toBe('Точка, v1.2.3');
    expect(container.querySelector('[data-chip-version]')).toBeNull();
    localStorage.clear();
  });

  it('держит номер версии типом: «8.3.0», а не готовая строка с названием', () => {
    expectTypeOf<'8.3.0'>().toMatchTypeOf<VersionNumber>();
    expectTypeOf<'Точка, v1.2.3'>().not.toMatchTypeOf<VersionNumber>();
    // @ts-expect-error версия обязательна: без неё платформа остаётся без номера на экране
    void (() => <AppShell platformKey="k" product="Точка" navItems={[]} currentPath="/" user={{ name: 'А', role: 'Б' }} onNavigate={() => {}} onLogout={() => {}}>x</AppShell>);
    // @ts-expect-error в проп идёт только номер, строку «Название, vX.Y.Z» собирает пакет
    void (() => <AppShell platformKey="k" product="Точка" version="Точка, v1.2.3" navItems={[]} currentPath="/" user={{ name: 'А', role: 'Б' }} onNavigate={() => {}} onLogout={() => {}}>x</AppShell>);
  });

  it('рендерит все слоты LoginShell и ровно три пункта обещания', () => {
    render(
      <LoginShell
        product="Оболочка"
        overline="Рабочее пространство"
        promise={{
          title: 'Обещание',
          description: 'Описание',
          items: ['Раз', 'Два', 'Три'],
          inset: { overline: 'Что получите', text: 'Отчёт', note: 'И карту' },
        }}
        form={<form aria-label="Вход"><h1>С возвращением</h1></form>}
        footer="© 2026 Чирков и партнёры"
        version="0.1.0"
      />,
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Вход' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('Что получите')).toHaveClass('chip-login__inset-overline');
    const line = screen.getByText('Оболочка, v0.1.0');
    expect(line).toHaveClass('chip-login__version');
    expect(line).toHaveAttribute('data-chip-version');
  });

  it('LoginShell без version не рисует строку (публичный вход клиента)', () => {
    const { container } = render(
      <LoginShell
        product="Оболочка"
        overline="Рабочее пространство"
        promise={{ title: 'Обещание', description: 'Описание', items: ['Раз', 'Два', 'Три'] }}
        form={<form aria-label="Вход" />}
        footer="© 2026 Чирков и партнёры"
      />,
    );
    expect(container.querySelector('[data-chip-version]')).toBeNull();
    expect(container.querySelector('.chip-login__version')).toBeNull();
  });
});
