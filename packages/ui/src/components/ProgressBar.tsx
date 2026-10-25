import type { CSSProperties } from 'react';

export interface ProgressBarProps {
  value: number;
  ariaLabel: string;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  showValue?: boolean;
  valueSuffix?: string;
}

type ProgressStyle = CSSProperties & { '--chip-progress-value': string };

export function ProgressBar({
  value,
  ariaLabel,
  tone = 'accent',
  showValue = false,
  valueSuffix = '%',
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const rounded = Math.round(clamped);
  const progressStyle: ProgressStyle = { '--chip-progress-value': `${clamped}%` };

  return (
    <div className="chip-progress">
      <div
        className="chip-progress__track"
        role="progressbar"
        aria-label={ariaLabel}
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${rounded}${valueSuffix}`}
      >
        <span className={`chip-progress__fill chip-progress__fill--${tone}`} style={progressStyle} />
      </div>
      {showValue && <span className="chip-progress__value">{rounded}{valueSuffix}</span>}
    </div>
  );
}
