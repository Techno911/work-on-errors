import { useState } from 'react';
import { formatTagName } from '@/lib/utils';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { ErrorFrequencyTag } from '@/types';
import { Badge, Button, Chip, Table, categoryColor } from '@chirkov/shell';
import { ColorDot } from '@/components/ui/ColorDot';

interface ErrorFrequencyChartProps {
  data: ErrorFrequencyTag[];
  selectedTagId?: string | null;
  onTagClick: (tagId: string) => void;
}

interface BarClickPayload {
  payload?: ErrorFrequencyTag;
}

export function ErrorFrequencyChart({ data, selectedTagId, onTagClick }: ErrorFrequencyChartProps) {
  const [asTable, setAsTable] = useState(false);

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-fg-subtle">
        <span className="text-page">📊</span>
        <div className="text-center">
          <p className="text-body font-medium text-fg-subtle">Нет данных за выбранный период</p>
          <p className="text-micro mt-1">Убедитесь, что есть проверенные записи с тегами ошибок</p>
        </div>
      </div>
    );
  }

  const handleBarClick = (barData: BarClickPayload) => {
    if (barData.payload?.tagId) {
      onTagClick(barData.payload.tagId);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <Button
          type="button"
          onClick={() => setAsTable(v => !v)}
          variant="link"
          size="sm"
          aria-pressed={asTable}
        >
          {asTable ? 'Графиком' : 'Таблицей'}
        </Button>
      </div>

      {asTable ? (
        <Table
          caption="Частота ошибок по тегам"
          rows={data}
          rowKey={(row) => row.tagId}
          mobile="cards"
          empty="Нет данных за выбранный период"
          rowAction={{
            label: (row) => `Выбрать тег ${formatTagName(row.tagName)}`,
            onSelect: (row) => onTagClick(row.tagId),
          }}
          columns={[
            {
              key: 'tag',
              header: 'Тег',
              render: (row) => (
                <span className="inline-flex items-center gap-2">
                  <ColorDot color={row.color} className="w-2.5 h-2.5" />
                  {formatTagName(row.tagName)}
                  {selectedTagId === row.tagId && <Badge tone="accent">Выбран</Badge>}
                </span>
              ),
            },
            { key: 'percentage', header: 'Частота', numeric: true, render: (row) => `${row.percentage}%` },
            { key: 'count', header: 'Записей', numeric: true, render: (row) => row.count },
          ]}
        />
      ) : (
        <>
          {/* Кликабельный список тегов — фильтр доступен с клавиатуры, не только мышью по столбцу. */}
          <div className="flex flex-wrap gap-x-2 gap-y-3 mb-3">
            {data.map((row) => {
              const active = selectedTagId === row.tagId;
              return (
                <Chip
                  key={row.tagId}
                  pressed={active}
                  onPressedChange={() => onTagClick(row.tagId)}
                >
                  <span className="inline-flex items-center gap-2">
                    <ColorDot color={row.color} className="w-2 h-2 ring-1 ring-surface" />
                    {formatTagName(row.tagName)}
                  </span>
                </Chip>
              );
            })}
          </div>
    {/* outline-none suppresses browser focus ring on SVG when bar is clicked.
       cursor-pointer applied via CSS — recharts bar already has cursor="pointer"
       but we also set it on the entire chart area for consistent UX */}
    <div
      className="[&_svg]:outline-none [&_svg_*]:outline-none [&_.recharts-bar-rectangle]:cursor-pointer [&_.recharts-yAxis_.recharts-cartesian-axis-tick]:cursor-pointer"
      role="img"
      aria-label={`Топ ошибок: ${data.map(d => `${formatTagName(d.tagName)} ${d.percentage}%`).join(', ')}`}
    >
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 52)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 40, left: 4, bottom: 4 }}
      >
        <XAxis
          type="number"
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 12, fill: 'var(--color-fg-subtle)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="tagName"
          width={200}
          tick={{ fontSize: 12, fill: 'var(--color-fg)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-border)', stroke: 'none' }}
          formatter={(value, _name, item) => [
            `${String(value)}% (${(item.payload as ErrorFrequencyTag | undefined)?.count ?? 0} записей)`,
            'Частота',
          ]}
          contentStyle={{
            borderRadius: '8px',
            border: '1px solid var(--color-border)',
            fontSize: '12px',
          }}
        />
        <Bar
          dataKey="percentage"
          radius={[0, 4, 4, 0]}
          cursor="pointer"
          onClick={handleBarClick}
        >
          {data.map((entry) => (
            <Cell
              key={entry.tagId}
              fill={categoryColor(entry.color).backgroundColor}
              opacity={selectedTagId && selectedTagId !== entry.tagId ? 0.4 : 1}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
    </div>
        </>
      )}
    </div>
  );
}
