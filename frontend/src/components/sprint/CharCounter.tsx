// Shared CharCounter component — used in SelfReviewForm and ReviewerForm

interface CharCounterProps {
  value: string;
  min: number;
}

export function CharCounter({ value, min }: CharCounterProps) {
  if (min === 0) return null;
  const count = value.trim().length;
  const remaining = min - count;
  const pct = Math.min(100, Math.round((count / min) * 100));
  const done = remaining <= 0;

  return (
    <div className="mt-1.5 space-y-1">
      {/* Progress bar */}
      <div className="h-1 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            backgroundColor: done ? 'var(--color-success)' : pct >= 33 ? 'var(--color-warning)' : 'var(--color-border-strong)',
          }}
        />
      </div>
      {/* Text */}
      <div className="flex justify-between text-micro">
        <span className={done ? 'text-success-fg' : pct >= 33 ? 'text-warning-fg' : 'text-fg-subtle'}>
          {done ? '✓ Достаточно' : `Ещё ${remaining} симв.`}
        </span>
        <span className="text-fg-subtle">{count}/{min}</span>
      </div>
    </div>
  );
}
