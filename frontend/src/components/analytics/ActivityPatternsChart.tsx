import type { ActivityPatternsData } from '@/types';

interface Props {
  data: ActivityPatternsData;
}

export function ActivityPatternsChart({ data }: Props) {
  const daysOfWeek = data?.daysOfWeek ?? [];
  const hours = data?.hours ?? [];

  const maxDayCount = Math.max(1, ...daysOfWeek.map(d => d.count));
  const maxHourCount = Math.max(1, ...hours.map(h => h.count));

  if ((data?.totalEntries ?? 0) === 0) {
    return (
      <div className="py-8 text-center text-body text-fg-subtle">
        Недостаточно данных для анализа паттернов
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* По дням недели */}
      <div>
        <h3 className="text-body font-semibold text-fg-muted mb-3">По дням недели</h3>
        <div className="space-y-2">
          {daysOfWeek.map((d) => {
            const pct = Math.round((d.count / maxDayCount) * 100);
            return (
              <div key={d.day} className="flex items-center gap-3">
                <span className="w-8 text-micro text-fg-subtle font-mono">{d.day}</span>
                <div className="flex-1 min-w-0 min-h-6 bg-surface-sunken rounded-chip overflow-hidden relative">
                  <div
                    className="absolute inset-y-0 left-0 rounded-chip transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: 'var(--color-accent)',
                    }}
                  />
                  <span className="relative flex flex-wrap items-center px-2 py-0.5 text-micro text-fg-muted font-medium">
                    {d.count} {d.count === 1 ? 'запись' : d.count < 5 ? 'записи' : 'записей'}
                    {d.avgSelfReviewLength > 0 && (
                      <span className="ml-2 text-fg-subtle">· ср. самоанализ {d.avgSelfReviewLength} симв.</span>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* По часам дня */}
      <div>
        <h3 className="text-body font-semibold text-fg-muted mb-3">По часам суток</h3>
        <div className="flex items-end gap-1 h-24">
          {hours.map((h) => {
            const pct = Math.round((h.count / maxHourCount) * 100);
            return (
              <div
                key={h.hour}
                className="flex-1 flex flex-col items-center gap-1"
                title={`${h.hour}:00 · ${h.count} ${h.count === 1 ? 'запись' : 'записей'}`}
              >
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t-chip transition-all duration-500"
                    style={{
                      height: `${pct}%`,
                      backgroundColor: h.count > 0 ? 'var(--color-accent)' : 'var(--color-border)',
                      minHeight: h.count > 0 ? 2 : 1,
                    }}
                  />
                </div>
                {h.hour % 3 === 0 && (
                  <span className="text-micro text-fg-subtle font-mono">{h.hour}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-micro text-fg-subtle">
        Всего записей: {data.totalEntries}. Данные отражают время создания записи.
      </p>
    </div>
  );
}
