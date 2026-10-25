import { useEffect, useState } from 'react';
import { sprintsApi } from '@/api/sprints';
import type { TeamProgress, ProgressZone } from '@/types';
import { Badge, Notice, Card } from '@chirkov/shell';
import { ColorDot } from '@/components/ui/ColorDot';

// Static config — Tailwind JIT picks up full class names from this object
const ZONE_CONFIG: Record<ProgressZone, { label: string; badgeColor: 'danger' | 'success' | 'warning'; dotColor: string; bgColor: string }> = {
  below: { label: 'Ниже нормы',     badgeColor: 'danger', dotColor: 'var(--color-danger)', bgColor: 'var(--color-danger-subtle)' },
  good:  { label: 'Норма',          badgeColor: 'success', dotColor: 'var(--color-success)', bgColor: 'var(--color-success-subtle)' },
  great: { label: 'Сильная неделя', badgeColor: 'warning', dotColor: 'var(--color-warning)', bgColor: 'var(--color-warning-subtle)' },
};

interface TeamProgressBarProps {
  sprintId: string;
}

export function TeamProgressBar({ sprintId }: TeamProgressBarProps) {
  const [data, setData] = useState<TeamProgress | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    sprintsApi
      .getTeamProgress(sprintId)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sprintId]);

  if (loading || !data || (data.teamMembers?.length ?? 0) === 0) return null;

  const below = data.teamMembers.filter(m => m.zone === 'below').length;
  const good  = data.teamMembers.filter(m => m.zone === 'good').length;
  const great = data.teamMembers.filter(m => m.zone === 'great').length;

  return (
    <Card padding="md">
      {data.isRampUp && (
        <div className="mb-3">
          <Notice tone="warning" title="Разгонная неделя.">
            Компанию запустили не с понедельника: на короткий старт пороги снижены, неделя не идёт в сравнение. Полная норма со следующего понедельника.
          </Notice>
        </div>
      )}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-body font-semibold text-fg">Прогресс команды</h3>
        <div className="flex items-center gap-3 text-micro text-fg-subtle">
          {great > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ZONE_CONFIG.great.dotColor }} />
              {great} · сильная неделя
            </span>
          )}
          {good > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ZONE_CONFIG.good.dotColor }} />
              {good} · в норме
            </span>
          )}
          {below > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: ZONE_CONFIG.below.dotColor }} />
              {below} · ниже нормы
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        {data.teamMembers.map(member => {
          const cfg = ZONE_CONFIG[member.zone];
          return (
            <div
              key={member.id}
              className="flex items-center justify-between py-1.5 px-3 rounded-card"
              style={{ backgroundColor: cfg.bgColor }}
            >
              <div className="flex items-center gap-2">
                <ColorDot color={member.color} className="w-2 h-2" />
                <span className="text-body font-medium text-fg">{member.fullName}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-micro text-fg-subtle">{member.entriesCount} зап.</span>
                <Badge tone={cfg.badgeColor}>
                  {cfg.label}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
