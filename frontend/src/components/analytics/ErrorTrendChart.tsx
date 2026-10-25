import { useState } from 'react';
import { formatTagName } from '@/lib/utils';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import type { ErrorTrendData } from '@/types';
import { Button, Table } from '@chirkov/shell';

interface ErrorTrendChartProps {
  data: ErrorTrendData | null;
  loading?: boolean;
}

// increasing = ошибок становится БОЛЬШЕ — плохо (красный)
// decreasing = ошибок становится МЕНЬШЕ — хорошо (зелёный)
const TREND_ICON: Record<string, string> = {
  increasing: '⬆️',
  decreasing: '⬇️',
  stable: '➡️',
};

const TREND_LABEL: Record<string, string> = {
  increasing: 'растёт, нужно внимание',
  decreasing: 'снижается, прогресс!',
  stable: 'стабильно',
};

const TREND_COLOR: Record<string, string> = {
  increasing: 'text-danger-fg',
  decreasing: 'text-success-fg',
  stable: 'text-fg-subtle',
};

export function ErrorTrendChart({ data, loading }: ErrorTrendChartProps) {
  const [asTable, setAsTable] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-fg-subtle text-body animate-pulse">
        Загрузка тренда...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-fg-subtle gap-2">
        <span className="text-page">👆</span>
        <span className="text-body">Нажмите на тег слева, чтобы увидеть тренд</span>
      </div>
    );
  }

  if (data.sprints.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-fg-subtle text-body">
        Недостаточно данных для отображения тренда
      </div>
    );
  }

  const ariaLabel = `Тренд по тегу ${formatTagName(data.tagName)}: ${data.sprints
    .map(s => `${s.sprintLabel}: ${s.count}`)
    .join(', ')}. ${TREND_LABEL[data.trend] ?? ''}`;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-body font-semibold text-fg-muted">{formatTagName(data.tagName)}</h3>
        <div className="flex items-center gap-3">
          <span className={`text-micro font-medium ${TREND_COLOR[data.trend] ?? 'text-fg-subtle'}`}>
            {TREND_ICON[data.trend]} {TREND_LABEL[data.trend]}
          </span>
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
      </div>
      {asTable ? (
        <Table
          caption="Количество ошибок по спринтам"
          rows={data.sprints}
          rowKey={(s) => s.sprintLabel}
          mobile="cards"
          empty="Нет данных по спринтам"
          columns={[
            { key: 'sprint', header: 'Спринт', render: (s) => s.sprintLabel },
            { key: 'count', header: 'Записей с ошибкой', numeric: true, render: (s) => s.count },
          ]}
        />
      ) : (
      <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data.sprints} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-sunken)" />
          <XAxis
            dataKey="sprintLabel"
            tick={{ fontSize: 12, fill: 'var(--color-fg-subtle)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: 'var(--color-fg-subtle)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v) => [`${String(v)} записей`, 'Количество']}
            contentStyle={{ borderRadius: '8px', border: '1px solid var(--color-border)', fontSize: '12px' }}
          />
          <Line
            type="monotone"
            dataKey="count"
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            dot={{ fill: 'var(--color-accent)', r: 5, strokeWidth: 0 }}
            activeDot={{ r: 7 }}
          />
        </LineChart>
      </ResponsiveContainer>
      </div>
      )}
    </div>
  );
}
