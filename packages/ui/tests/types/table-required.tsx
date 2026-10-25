import { Table, type TableColumn } from '../../src';

interface Row {
  id: string;
}

const rows: Row[] = [];
const columns: TableColumn<Row>[] = [{ key: 'id', header: 'ID', render: (row) => row.id }];
const common = { caption: 'Строки', rows, rowKey: (row: Row) => row.id, columns };

<Table {...common} mobile="cards" empty="Строк пока нет" />;

// @ts-expect-error mobile — решение экрана, поэтому умолчания нет.
<Table {...common} empty="Строк пока нет" />;

// @ts-expect-error empty обязателен, чтобы пустой экран не исчезал.
<Table {...common} mobile="scroll" />;
