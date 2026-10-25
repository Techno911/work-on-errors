import { useState } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { Button, Card } from '@chirkov/shell';
import { ExampleReviewModal } from './ExampleReviewModal';

export interface FirstStep {
  label: string;
  done: boolean;
}

export interface FirstStepsCardProps {
  steps: FirstStep[];
  showExample?: boolean;
  /** Навигационная подсказка без галочки и без учёта в завершении (например, «откройте
   *  запись на доске»). Не влияет на счётчик «N из M» и на автоматическое скрытие. */
  hint?: string;
  /** Действие скрытия карточки. Не передаётся в режиме «Глазами» — там только просмотр. */
  onHide?: () => void;
  /** Запрос скрытия в полёте: кнопка блокируется. */
  hideBusy?: boolean;
  /** Последняя попытка скрытия упала: карточка остаётся, даём текст и повтор. */
  hideError?: boolean;
}

/**
 * Чек-лист первых шагов: учим действием, а не чтением. Живёт на дашборде,
 * пока все шаги не выполнены и человек сам её не скрыл; отметки ставятся
 * автоматически по фактам за всё время (firstSteps в ответе dashboard).
 */
export function FirstStepsCard({ steps, showExample = false, hint, onHide, hideBusy = false, hideError = false }: FirstStepsCardProps) {
  const [exampleOpen, setExampleOpen] = useState(false);
  const doneCount = steps.filter(s => s.done).length;
  if (doneCount === steps.length) return null;

  return (
    <Card padding="md" tone="accent">
      <div className="flex items-center justify-between mb-3 gap-2">
        <h2 className="text-body-lg font-semibold text-fg">Первые шаги</h2>
        <span className="text-micro text-fg-subtle">{doneCount} из {steps.length}</span>
      </div>
      <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden mb-4">
        <div
          className="h-full bg-accent rounded-full transition-all duration-500"
          style={{ width: `${Math.max(8, Math.round((doneCount / steps.length) * 100))}%` }}
        />
      </div>
      <ul className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-body">
            {s.done
              ? <CheckCircle2 className="w-4 h-4 text-success-fg flex-shrink-0" />
              : <Circle className="w-4 h-4 text-border flex-shrink-0" />}
            <span className={s.done ? 'text-fg-subtle line-through' : 'text-fg-muted'}>{s.label}</span>
          </li>
        ))}
        {hint && (
          <li className="flex items-center gap-2 text-body text-fg-subtle">{hint}</li>
        )}
      </ul>
      {hideError && (
        <p className="text-micro text-danger mt-3">Не удалось сохранить. Проверьте связь и попробуйте ещё раз.</p>
      )}
      {(showExample || onHide) && (
        <div className="first-steps-actions mt-4 flex items-center gap-4 flex-wrap">
          {showExample && (
            <Button
              type="button"
              onClick={() => setExampleOpen(true)}
              variant="link"
              size="sm"
            >
              Посмотреть пример разбора →
            </Button>
          )}
          {onHide && (
            <Button
              type="button"
              onClick={onHide}
              variant="link"
              size="sm"
              disabled={hideBusy}
            >
              {hideBusy ? 'Скрываем…' : 'Скрыть подсказку'}
            </Button>
          )}
        </div>
      )}

      {exampleOpen && <ExampleReviewModal open onClose={() => setExampleOpen(false)} />}
    </Card>
  );
}
