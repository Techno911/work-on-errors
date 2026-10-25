import { formatTagName } from '@/lib/utils';
import type { ManagerStat } from '@/types';
import { Avatar } from '@chirkov/shell';

interface ManagerStatsTableProps {
  data: ManagerStat[];
}

export function ManagerStatsTable({ data }: ManagerStatsTableProps) {
  if (data.length === 0) {
    return (
      <div className="py-8 text-center text-body text-fg-subtle">
        Нет данных по менеджерам
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.map(manager => (
        <div key={manager.managerId} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Avatar name={manager.fullName} color={manager.color ?? undefined} size="md" />
              <div className="min-w-0">
                <p className="text-body font-semibold text-fg truncate">{manager.fullName}</p>
                <p className="text-micro text-fg-subtle">
                  {manager.totalEntries} {manager.totalEntries === 1 ? 'запись' : manager.totalEntries < 5 ? 'записи' : 'записей'}
                  {manager.activeDays !== undefined && <> &nbsp;•&nbsp; за {manager.activeDays} из 4 дней</>}
                  &nbsp;•&nbsp; {manager.reviewed} проверено &nbsp;•&nbsp; ср. самоанализ: {manager.avgSelfReviewLength} симв.
                </p>
              </div>
            </div>
            <span className="text-body font-semibold text-fg-muted flex-shrink-0">{manager.completionRate}%</span>
          </div>

          {/* Progress bar — цвет зависит от прогресса */}
          <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${manager.completionRate}%`,
                backgroundColor: manager.completionRate === 100 ? 'var(--color-success)'
                  : manager.completionRate >= 50 ? 'var(--color-accent)'
                  : 'var(--color-danger)',
              }}
            />
          </div>

          {/* Top errors */}
          {(manager.topErrors ?? []).length > 0 && (
            <p className="text-micro text-fg-subtle">
              Топ ошибок: {(manager.topErrors ?? []).map(e => `${formatTagName(e.tagName)} (${e.count})`).join(', ')}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
