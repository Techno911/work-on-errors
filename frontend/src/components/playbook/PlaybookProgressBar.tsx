import { CheckCircle2 } from 'lucide-react';
import { Card } from '@chirkov/shell';
import type { PlaybookProgress } from '@/types';

interface PlaybookProgressBarProps {
  progress: PlaybookProgress;
}

export function PlaybookProgressBar({ progress }: PlaybookProgressBarProps) {
  const { activeCount, target } = progress;
  const done = activeCount >= target;
  const pct = Math.min(100, Math.round((activeCount / target) * 100));

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-2">
        <p className="text-body font-medium text-fg-muted">
          {done ? (
            <span className="flex items-center gap-1.5 text-success-fg">
              <CheckCircle2 className="w-4 h-4" /> Первая версия собрана: {activeCount} карточек
            </span>
          ) : (
            <>Собрано {activeCount} из {target} карточек до первой версии</>
          )}
        </p>
        <span className="text-micro text-fg-subtle">{pct}%</span>
      </div>
      <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {!done && (
        <p className="text-micro text-fg-subtle mt-2">
          Карточки появляются сами: платформа замечает повторы в разборах, вам остаётся подтвердить их в разделе «Ждут решения».
        </p>
      )}
    </Card>
  );
}
