import { pluralRu } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { gamificationApi, type GamificationProfile } from '@/api/gamification';
import { LevelBadge } from './LevelBadge';
import { XpBar } from './XpBar';
import { StreakBadge } from './StreakBadge';
import { Card } from '@chirkov/shell';
import { AchievementBadge } from './AchievementBadge';

const ALL_ACHIEVEMENTS = ['first_submit', 'sniper', 'writer', 'lightning', 'great_3x', 'streak_7', 'streak_30'];

interface Props { userId: string; }

export function GamificationPanel({ userId }: Props) {
  const [profile, setProfile] = useState<GamificationProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    gamificationApi.getMyProfile()
      .then(r => setProfile(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) return (
    <Card padding="md" className="space-y-4 animate-pulse">
      <div className="h-5 bg-surface-sunken rounded-chip w-32" />
      <div className="h-2 bg-surface-sunken rounded-full" />
    </Card>
  );
  if (!profile) return null;

  const earnedTypes = new Set(profile.achievements.map(a => a.type));
  const earned = profile.achievements;

  return (
    <Card padding="md" className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-body-lg font-semibold text-fg">Мой рост</h2>
        <div className="flex items-center gap-2">
          <StreakBadge streak={profile.currentStreak} size="sm" />
          <LevelBadge level={profile.level} title={profile.title} emoji={profile.emoji} size="sm" />
        </div>
      </div>

      {/* XP bar */}
      <XpBar totalXp={profile.totalXp} nextXp={profile.nextXp} weeklyXp={profile.weeklyXp} />

      {/* Streak detail */}
      {profile.currentStreak > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-block bg-accent-subtle border border-accent-subtle-hover">
          <span className="text-title">🔥</span>
          <div>
            <p className="text-body font-medium text-accent-fg-deep">
              {profile.currentStreak} {profile.currentStreak === 1 ? 'неделя' : profile.currentStreak < 5 ? 'недели' : 'недель'} подряд!
            </p>
            {profile.bestStreak > profile.currentStreak && (
              <p className="text-micro text-accent">Рекорд: {profile.bestStreak} {pluralRu(profile.bestStreak, 'неделя', 'недели', 'недель')}</p>
            )}
          </div>
        </div>
      )}

      {/* Achievements */}
      {earned.length > 0 && (
        <div>
          <p className="text-micro font-medium text-fg-subtle mb-2">
            Достижения <span className="text-accent">{earned.length}/{ALL_ACHIEVEMENTS.length}</span>
          </p>
          {/* 4 колонки на 375px сжимают длинные описания («Скоро: спринты без повторения
              старых ошибок») в 6-7 строк — на телефоне 2 колонки, от sm снова 4. Длинное слово
              («непоколебимы») переносится по слогам в самом описании (hyphens-auto, lang=ru). */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {ALL_ACHIEVEMENTS.map(type => {
              const ach = profile.achievements.find(a => a.type === type);
              return (
                <AchievementBadge
                  key={type}
                  type={type}
                  earnedAt={ach?.earnedAt}
                  locked={!earnedTypes.has(type)}
                />
              );
            })}
          </div>
        </div>
      )}

      {earned.length === 0 && (
        <p className="text-micro text-fg-subtle text-center py-1">
          Отправьте первую запись, чтобы начать зарабатывать достижения 🚀
        </p>
      )}
    </Card>
  );
}
