import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink, Table, computeTableScrollEdges, type TableColumn } from '../src';

interface Row {
  id: string;
  name: string;
  amount: number;
}

const columns: readonly TableColumn<Row>[] = [
  { key: 'name', header: 'Название', render: (row) => row.name },
  { key: 'amount', header: 'Сумма', numeric: true, render: (row) => `${row.amount} ₽` },
];

const rows: readonly Row[] = [{ id: 'first', name: 'Исследование рынка', amount: 128000 }];

afterEach(cleanup);

describe('Table', () => {
  it('оставляет заголовок и показывает пустое состояние после области прокрутки', () => {
    render(
      <Table
        caption="Бюджеты"
        rows={[]}
        rowKey={(row: Row) => row.id}
        columns={columns}
        mobile="cards"
        empty="Бюджетов пока нет"
      />,
    );
    const table = screen.getByRole('table', { name: 'Бюджеты' });
    const empty = screen.getByRole('status');
    expect(screen.getByRole('columnheader', { name: 'Название' })).toBeInTheDocument();
    expect(empty).toHaveTextContent('Бюджетов пока нет');
    expect(empty.closest('.chip-table__scroll')).toBeNull();
    expect(table.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('выравнивает числовую колонку вправо и включает табличные цифры', () => {
    render(
      <Table
        caption="Бюджеты"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        mobile="scroll"
        empty="Бюджетов пока нет"
      />,
    );
    const cell = screen.getByText('128000 ₽').closest('td');
    expect(cell).toHaveClass('chip-table__cell--numeric', 'chip-table__cell--align-end');
  });

  it('кладёт мобильную подпись над каждым значением карточки', () => {
    render(
      <Table
        caption="Бюджеты"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        mobile="cards"
        empty="Бюджетов пока нет"
      />,
    );
    const cell = screen.getByText('Исследование рынка').closest('td');
    expect(cell?.querySelector('.chip-table__mobile-label')).toHaveTextContent('Название');
    expect(cell?.querySelector('.chip-table__value')).toHaveTextContent('Исследование рынка');
    expect(screen.getByRole('table').closest('.chip-table')).toHaveAttribute('data-mobile', 'cards');
  });

  it('показывает тень только у края, за которым реально есть содержимое', () => {
    const { container } = render(
      <Table
        caption="Бюджеты"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        mobile="scroll"
        empty="Бюджетов пока нет"
      />,
    );
    const scroll = container.querySelector('.chip-table__scroll')!;
    Object.defineProperties(scroll, {
      scrollWidth: { configurable: true, value: 600 },
      clientWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });
    fireEvent.scroll(scroll);
    expect(container.querySelector('.chip-table__edge--left')).not.toBeInTheDocument();
    expect(container.querySelector('.chip-table__edge--right')).toBeInTheDocument();

    Object.defineProperty(scroll, 'scrollLeft', { configurable: true, value: 300 });
    fireEvent.scroll(scroll);
    expect(container.querySelector('.chip-table__edge--left')).toBeInTheDocument();
    expect(container.querySelector('.chip-table__edge--right')).not.toBeInTheDocument();

    Object.defineProperties(scroll, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 300 },
      scrollLeft: { configurable: true, value: 0 },
    });
    fireEvent.scroll(scroll);
    expect(container.querySelector('.chip-table__edge')).not.toBeInTheDocument();
  });

  it('делает действие строки доступным с клавиатуры', () => {
    const onSelect = vi.fn();
    render(
      <Table
        caption="Бюджеты"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        mobile="scroll"
        empty="Бюджетов пока нет"
        rowAction={{ label: (row) => `Открыть ${row.name}`, onSelect }}
      />,
    );
    const row = screen.getByRole('button', { name: 'Открыть Исследование рынка' });
    expect(row).toHaveAttribute('data-chip-control');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(rows[0]);
  });

  it('выводит несколько действий одним рядом последней колонки', () => {
    render(
      <Table
        caption="Бюджеты"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        mobile="cards"
        empty="Бюджетов пока нет"
        action={{
          label: (row) => `Действия для ${row.name}`,
          render: () => (
            <>
              <Button size="sm" variant="secondary">Изменить</Button>
              <ButtonLink href="#remove" size="sm" variant="link">Убрать из плана</ButtonLink>
            </>
          ),
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Изменить' })).toHaveAttribute('data-chip-control');
    expect(screen.getByRole('link', { name: 'Убрать из плана' })).toHaveAttribute('data-chip-control');
    expect(screen.getByRole('button', { name: 'Изменить' }).closest('.chip-table__value'))
      .toContainElement(screen.getByRole('link', { name: 'Убрать из плана' }));
    expect(screen.getByRole('columnheader', { name: 'Действия' })).toHaveTextContent('Действия');
    expect(screen.queryByText('Действие')).not.toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
  });
});

describe('computeTableScrollEdges', () => {
  it('различает левый и правый край фактического переполнения', () => {
    expect(computeTableScrollEdges({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 }))
      .toEqual({ left: false, right: false });
    expect(computeTableScrollEdges({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 }))
      .toEqual({ left: false, right: true });
    expect(computeTableScrollEdges({ scrollWidth: 600, clientWidth: 300, scrollLeft: 150 }))
      .toEqual({ left: true, right: true });
  });
});
