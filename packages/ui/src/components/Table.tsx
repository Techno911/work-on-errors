import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type Key,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface TableColumn<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  numeric?: boolean;
  align?: 'start' | 'center' | 'end';
  width?: 'auto' | 'compact' | 'wide';
  mobileLabel?: string;
}

export interface TableAction<Row> {
  label: (row: Row) => string;
  render: (row: Row) => ReactNode;
}

export interface TableRowAction<Row> {
  label: (row: Row) => string;
  onSelect: (row: Row) => void;
}

type NativeTableProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className' | 'style'>;

export interface TableProps<Row> extends NativeTableProps {
  caption: string;
  rows: readonly Row[];
  rowKey: (row: Row) => Key;
  columns: readonly TableColumn<Row>[];
  mobile: 'cards' | 'scroll';
  empty: string;
  action?: TableAction<Row>;
  rowAction?: TableRowAction<Row>;
  stickyFirstColumn?: boolean;
}

export interface TableScrollGeometry {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

export function computeTableScrollEdges({
  scrollWidth,
  clientWidth,
  scrollLeft,
}: TableScrollGeometry): { left: boolean; right: boolean } {
  const overflow = scrollWidth > clientWidth + 1;
  return {
    left: overflow && scrollLeft > 1,
    right: overflow && scrollLeft + clientWidth < scrollWidth - 1,
  };
}

function cellClasses<Row>(column: TableColumn<Row>) {
  const align = column.align ?? (column.numeric ? 'end' : 'start');
  return [
    'chip-table__cell',
    `chip-table__cell--align-${align}`,
    `chip-table__cell--width-${column.width ?? 'auto'}`,
    column.numeric ? 'chip-table__cell--numeric' : '',
  ].filter(Boolean).join(' ');
}

export function Table<Row>({
  caption,
  rows,
  rowKey,
  columns,
  mobile,
  empty,
  action,
  rowAction,
  stickyFirstColumn = false,
  ...props
}: TableProps<Row>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const updateEdges = useCallback(() => {
    const element = scrollRef.current;
    if (!element || mobile !== 'scroll') {
      setEdges({ left: false, right: false });
      return;
    }
    setEdges(computeTableScrollEdges({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft,
    }));
  }, [mobile]);

  useEffect(() => {
    updateEdges();
    const element = scrollRef.current;
    if (!element) return;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateEdges);
    observer?.observe(element);
    window.addEventListener('resize', updateEdges);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateEdges);
    };
  }, [columns, rows, updateEdges]);

  const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: Row) => {
    if (!rowAction || event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    rowAction.onSelect(row);
  };

  return (
    <div
      {...props}
      className={`chip-table chip-table--${mobile}${stickyFirstColumn ? ' chip-table--sticky-first' : ''}`}
      data-mobile={mobile}
    >
      <div className="chip-table__frame">
        <div className="chip-table__scroll-region">
          {edges.left && <span className="chip-table__edge chip-table__edge--left" aria-hidden="true" />}
          <div ref={scrollRef} className="chip-table__scroll" onScroll={updateEdges}>
            <table>
              <caption>{caption}</caption>
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      scope="col"
                      className={cellClasses(column)}
                    >
                      {column.header}
                    </th>
                  ))}
                  {action && (
                    <th scope="col" className="chip-table__action-heading">
                      <span className="chip-table__action-heading-label">Действия</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={rowKey(row)}
                    className={rowAction ? 'chip-table__row chip-table__row--interactive' : 'chip-table__row'}
                    role={rowAction ? 'button' : undefined}
                    tabIndex={rowAction ? 0 : undefined}
                    data-chip-control={rowAction ? '' : undefined}
                    aria-label={rowAction?.label(row)}
                    onClick={rowAction ? () => rowAction.onSelect(row) : undefined}
                    onKeyDown={rowAction ? (event) => handleRowKeyDown(event, row) : undefined}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cellClasses(column)}
                        data-column={column.key}
                      >
                        <span className="chip-table__mobile-label">{column.mobileLabel ?? column.header}</span>
                        <span className="chip-table__value">{column.render(row)}</span>
                      </td>
                    ))}
                    {action && (
                      <td className="chip-table__action" aria-label={action.label(row)}>
                        <span className="chip-table__value">{action.render(row)}</span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {edges.right && <span className="chip-table__edge chip-table__edge--right" aria-hidden="true" />}
        </div>
        {rows.length === 0 && <div className="chip-table__empty" role="status">{empty}</div>}
      </div>
    </div>
  );
}
