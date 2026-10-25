import { useEffect, useState } from 'react';
import { gamificationApi, type LeaderboardEntry } from '@/api/gamification';
import { Avatar, Card } from '@chirkov/shell';
import { LevelBadge } from './LevelBadge';

interface Props { companyId: string; }

export function Leaderboard({ companyId }: Props) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gamificationApi.getLeaderboard(companyId)
      .then(r => setEntries(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  if (loading) return (
    <Card padding="md" className="animate-pulse space-y-3">
      <div className="h-5 bg-surface-sunken rounded-chip w-40" />
      {[1,2,3].map(i => <div key={i} className="h-12 bg-canvas rounded-block" />)}
    </Card>
  );

  if (entries.length === 0) return null;

  const MEDALS = ['🥇','🥈','🥉'];
  const MEDAL_LABELS = ['1-е место','2-е место','3-е место'];

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-body-lg font-semibold text-fg">Рейтинг команды</h2>
        <span className="text-micro text-fg-subtle">по XP за неделю</span>
      </div>
      <div className="space-y-2">
        {entries.map((e, i) => (
          <div
            key={e.id}
            className={`flex items-center gap-3 p-3 rounded-block ${i === 0 ? 'bg-warning-subtle border border-warning-subtle' : 'hover:bg-canvas'}`}
          >
            <span className="w-5 text-center text-body font-bold text-fg-subtle">
              {i < 3
                ? <span role="img" aria-label={MEDAL_LABELS[i]}>{MEDALS[i]}</span>
                : `${i + 1}`}
            </span>
            <Avatar name={e.fullName} src={e.avatarUrl ?? undefined} color={e.color ?? undefined} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-body font-medium text-fg truncate">{e.fullName}</p>
                <LevelBadge level={e.level} title={e.levelTitle} emoji={e.levelEmoji} size="sm" />
                {e.achievementCount > 0 && (
                  <span className="text-micro text-fg-subtle">
                    <span role="img" aria-label="достижений">🏅</span>{e.achievementCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <div
                  role="progressbar"
                  aria-valuenow={entries[0].weeklyXp > 0 ? Math.round((e.weeklyXp / entries[0].weeklyXp) * 100) : 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${e.fullName}: ${e.weeklyXp} XP за неделю`}
                  className="flex-1 h-1.5 bg-surface-sunken rounded-full overflow-hidden max-w-[120px]"
                >
                  <div
                    className="h-full bg-accent-focus rounded-full"
                    style={{ width: `${entries[0].weeklyXp > 0 ? Math.round((e.weeklyXp / entries[0].weeklyXp) * 100) : 0}%` }}
                  />
                </div>
                <span className="text-micro text-fg-subtle">+{e.weeklyXp} XP</span>
                {e.currentStreak > 0 && (
                  <span className="text-micro text-accent-hover">
                    <span role="img" aria-label="серия">🔥</span>{e.currentStreak}
                  </span>
                )}
              </div>
            </div>
            <span className="text-micro text-fg-subtle flex-shrink-0">{e.totalXp} всего</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
