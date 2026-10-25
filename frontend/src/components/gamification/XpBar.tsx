interface Props {
  totalXp: number;
  nextXp: number | null;
  weeklyXp: number;
}

const LEVEL_THRESHOLDS = [0, 0, 200, 500, 1000, 2000];

export function XpBar({ totalXp, nextXp, weeklyXp }: Props) {
  // Определяем предыдущий порог
  const prevThresholds = LEVEL_THRESHOLDS.filter(t => t <= totalXp);
  const prevXp = prevThresholds[prevThresholds.length - 1] ?? 0;

  const pct = nextXp
    ? Math.min(100, Math.round(((totalXp - prevXp) / (nextXp - prevXp)) * 100))
    : 100;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-micro text-fg-subtle">{totalXp} XP всего</span>
        {nextXp && <span className="text-micro text-fg-subtle">{nextXp - totalXp} XP до следующего уровня</span>}
        {!nextXp && <span className="text-micro text-warning-fg font-medium">Максимальный уровень!</span>}
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Прогресс до следующего уровня"
        className="h-2 bg-surface-sunken rounded-full overflow-hidden"
      >
        <div
          className="h-full bg-gradient-to-r from-accent-focus to-accent rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {weeklyXp > 0 && (
        <p className="text-micro text-success-fg mt-1">+{weeklyXp} XP на этой неделе</p>
      )}
    </div>
  );
}
