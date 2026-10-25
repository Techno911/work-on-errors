import { Card } from '@chirkov/shell';

const ACHIEVEMENT_META: Record<string, { emoji: string; title: string; desc: string }> = {
  first_submit:  { emoji: '🚀', title: 'Первый шаг',    desc: 'Первая отправленная запись' },
  sniper:        { emoji: '🎯', title: 'Снайпер',        desc: 'Скоро: спринты без повторения старых ошибок' },
  writer:        { emoji: '📝', title: 'Писатель',       desc: '5 подробных самоанализов подряд' },
  lightning:     { emoji: '⚡', title: 'Молния',         desc: 'Все записи спринта: минимум за день до конца недели' },
  great_3x:      { emoji: '👑', title: 'Сильная серия', desc: '3 сильные недели подряд' },
  streak_7:      { emoji: '🔥', title: '7 недель подряд', desc: 'Серия без единого пропуска' },
  streak_30:     { emoji: '💎', title: 'Легенда',        desc: '30 недель серии: вы непоколебимы' },
};

interface Props {
  type: string;
  earnedAt?: string;
  locked?: boolean;
}

/**
 * Условие достижения — постоянным текстом под названием (а не скрытым тултипом):
 * цель, которую не видно, не управляет поведением; на телефоне hover недоступен.
 */
export function AchievementBadge({ type, earnedAt, locked = false }: Props) {
  const meta = ACHIEVEMENT_META[type] ?? { emoji: '🏅', title: type, desc: '' };
  return (
    <Card
      padding="sm"
      surface="canvas"
      radius="block"
      tone={locked ? undefined : 'accent'}
      className={`flex flex-col items-center gap-1 transition-all ${locked ? 'opacity-60' : ''}`}
      data-ui-role="achievement-card"
    >
      <span className={`text-section ${locked ? 'grayscale opacity-60' : ''}`}>{meta.emoji}</span>
      <p className="text-micro font-semibold text-fg-muted text-center">{meta.title}</p>
      {locked && meta.desc && (
        <p className="text-micro text-fg-subtle text-center hyphens-auto [hyphenate-limit-chars:10_4_4] [-webkit-hyphenate-limit-before:4] [-webkit-hyphenate-limit-after:4]">{meta.desc}</p>
      )}
      {earnedAt && !locked && (
        <p className="text-micro text-fg-subtle">
          {new Date(earnedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
        </p>
      )}
    </Card>
  );
}
