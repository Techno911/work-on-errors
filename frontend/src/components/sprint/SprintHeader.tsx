import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Sprint } from '@/types';
import { Button, Card } from '@chirkov/shell';

interface SprintHeaderProps {
  sprint: Sprint;
  prevSprint?: Sprint | null;
  nextSprint?: Sprint | null;
  onNavigate: (sprintId: string) => void;
  companyName?: string;
  /** Задан, когда открыта НЕ текущая неделя: прямой выход к идущей. */
  onGoCurrent?: () => void;
}

export function SprintHeader({ sprint, prevSprint, nextSprint, onNavigate, companyName, onGoCurrent }: SprintHeaderProps) {
  const endDate = new Date(sprint.endDate);
  const now = new Date();
  const daysLeft = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  const endText = sprint.status === 'active'
    ? (daysLeft > 0 ? `через ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}` : 'сегодня')
    : sprint.status === 'completed' ? 'завершён' : 'архив';

  return (
    <Card padding="none">
      <div className="px-6 py-4">
        {/* Top row: sprint navigation */}
        <div className="flex items-center justify-between">
          {/* Prev sprint */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => prevSprint && onNavigate(prevSprint.id)}
            disabled={!prevSprint}
            title={prevSprint?.label}
            aria-label={prevSprint ? `Предыдущий спринт: ${prevSprint.label}` : 'Предыдущий спринт'}
            icon={<ChevronLeft />}
          >
            <span className="hidden sm:inline" aria-hidden="true">Пред.</span>
          </Button>

          {/* Center: title + sprint label */}
          <div className="text-center">
            <p className="text-body text-fg-subtle">{sprint.label}</p>
          </div>

          {/* Next sprint */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => nextSprint && onNavigate(nextSprint.id)}
            disabled={!nextSprint}
            title={nextSprint?.label}
            aria-label={nextSprint ? `Следующий спринт: ${nextSprint.label}` : 'Следующий спринт'}
            iconRight={<ChevronRight />}
          >
            <span className="hidden sm:inline" aria-hidden="true">След.</span>
          </Button>
        </div>

        {/* Bottom row: meta info */}
        <div className="flex items-center justify-center gap-4 mt-2 text-body text-fg-subtle">
          {companyName && <span>📍 {companyName}</span>}
          <span className={
            sprint.status !== 'active'
              ? 'text-fg-subtle'
              : daysLeft <= 0
                ? 'text-danger-fg font-semibold'
                : daysLeft <= 3
                  ? 'text-warning-fg font-medium'
                  : 'text-fg-muted'
          }>
            {sprint.status === 'active'
              ? <>Спринт заканчивается <span className="font-medium">{endText}</span></>
              : <>Спринт <span className="font-medium">{endText}</span></>}
          </span>
          {/* Выход к идущей неделе прямой кнопкой. Раньше единственным способом была стрелка
              «След.», а она серая, пока следующей недели нет в базе, и человек читал это как
              «платформа не пускает дальше». */}
          {onGoCurrent && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onGoCurrent}
            >
              К текущей неделе
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
