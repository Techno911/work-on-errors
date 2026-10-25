import { Link } from 'react-router-dom';
import type { ReviewerStats } from '@/types';
import { Card } from '@chirkov/shell';
import { AlertTriangle, CheckCircle2, Clock, FileText, ChevronRight, CalendarDays } from 'lucide-react';

interface Props {
  data: ReviewerStats;
}

/** Точка-маркер статуса конкретной метрики: зелёная — в норме, красная — проседает. */
function MetricDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: ok ? 'var(--color-success)' : 'var(--color-danger)' }}
      aria-label={ok ? 'в норме' : 'ниже нормы'}
    />
  );
}

/**
 * Показатели РОПа за неделю. Фон нейтральный, статус — у каждой метрики свой:
 * выполненные нормативы не красятся в красный из-за одной провальной.
 */
export function ReviewerStatsCard({ data }: Props) {
  const hasNorm = data.norms.minReviewsPerWeek > 0;
  const reviewsProgress = hasNorm
    ? Math.min(100, Math.round((data.reviewsWritten / data.norms.minReviewsPerWeek) * 100))
    : 0;

  // Статусы по каждой метрике (null = норматив не задан / данных нет)
  const okReviews = hasNorm ? data.reviewsWritten >= data.norms.minReviewsPerWeek : null;
  const okMedian = data.medianHoursToRespond > 0 ? data.medianHoursToRespond <= data.norms.maxHoursToRespond : null;
  const okLen = data.reviewsWritten > 0 ? data.avgReviewChars >= data.norms.minReviewCharsAvg : null;
  const okQuality = data.reviewsWritten > 0 ? data.qualityPct >= data.norms.qualityThresholdPct : null;
  // Ритм оцениваем только когда неделя уже идёт: в понедельник «1 из 5» не повод для красного.
  const okDays = data.reviewDays === undefined ? null : data.reviewDays >= 4 ? true : data.reviewDays >= 2 ? null : false;

  // Заголовок называет конкретную причину, а не пугает всем сразу
  const headline = !hasNorm
    ? 'Норматив не задан'
    : okReviews === false
      ? `Отставание по ревью: ${data.reviewsWritten} из ${data.norms.minReviewsPerWeek} на этой неделе`
      : [okMedian, okLen, okQuality].includes(false)
        ? 'Есть метрика ниже нормы, смотрите отметки'
        : 'Все показатели в норме';
  const headlineColor = data.normStatus === 'red' ? 'var(--color-danger-fg)' : data.normStatus === 'yellow' ? 'var(--color-warning-fg)' : data.normStatus === 'green' ? 'var(--color-success-fg)' : 'var(--color-fg-subtle)';

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div className="min-w-0">
          <h3 className="text-body font-semibold text-fg">Ваши показатели за неделю</h3>
          <p className="text-micro mt-0.5 font-medium" style={{ color: headlineColor }}>{headline}</p>
        </div>
        {data.normStatus === 'green' && <CheckCircle2 className="w-6 h-6 flex-shrink-0" style={{ color: 'var(--color-success)' }} />}
        {data.normStatus === 'red' && <AlertTriangle className="w-6 h-6 flex-shrink-0" style={{ color: 'var(--color-danger)' }} />}
      </div>

      {/* Контур признания: серия недель в зелёной зоне + личный рекорд */}
      {(data.streakWeeks ?? 0) >= 2 && (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-card" style={{ backgroundColor: 'var(--color-success-subtle)', border: '1px solid var(--color-success-border)' }}>
          <span className="text-body font-semibold" style={{ color: 'var(--color-success-fg)' }}>
            {data.streakWeeks} {(data.streakWeeks ?? 0) % 10 === 1 && (data.streakWeeks ?? 0) % 100 !== 11 ? 'неделя' : [2, 3, 4].includes((data.streakWeeks ?? 0) % 10) && ![12, 13, 14].includes((data.streakWeeks ?? 0) % 100) ? 'недели' : 'недель'} подряд все нормативы в зелёной зоне
          </span>
          {(data.bestStreakWeeks ?? 0) > (data.streakWeeks ?? 0) && (
            <span className="text-micro text-fg-subtle">· личный рекорд {data.bestStreakWeeks}</span>
          )}
          {(data.bestStreakWeeks ?? 0) === (data.streakWeeks ?? 0) && (data.streakWeeks ?? 0) >= 3 && (
            <span className="text-micro font-medium" style={{ color: 'var(--color-success-fg)' }}>· это личный рекорд</span>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-card p-3 border" style={{ borderColor: okReviews === false ? 'var(--color-danger-border)' : 'var(--color-surface-sunken)', backgroundColor: okReviews === false ? 'var(--color-danger-subtle)' : 'var(--color-canvas)' }}>
          <div className="flex items-center gap-1.5 text-micro text-fg-subtle mb-1">
            <FileText className="w-3.5 h-3.5" />
            Ревью
            <MetricDot ok={okReviews} />
          </div>
          <div className="text-title font-semibold text-fg">
            {data.reviewsWritten}
            {hasNorm && <span className="text-fg-subtle text-body font-normal"> / {data.norms.minReviewsPerWeek}</span>}
          </div>
          {hasNorm && (
            <>
              <div className="mt-1.5 h-1 bg-surface-sunken rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${reviewsProgress}%`, backgroundColor: okReviews ? 'var(--color-success)' : 'var(--color-danger)' }}
                />
              </div>
              {okReviews === false && (
                <div className="text-micro text-fg-subtle mt-1">
                  осталось {data.norms.minReviewsPerWeek - data.reviewsWritten} до плана недели
                </div>
              )}
            </>
          )}
        </div>

        <div className="rounded-card p-3 border" style={{ borderColor: okMedian === false ? 'var(--color-danger-border)' : 'var(--color-surface-sunken)', backgroundColor: okMedian === false ? 'var(--color-danger-subtle)' : 'var(--color-canvas)' }}>
          <div className="flex items-center gap-1.5 text-micro text-fg-subtle mb-1">
            <Clock className="w-3.5 h-3.5" />
            Скорость ответа
            <MetricDot ok={okMedian} />
          </div>
          <div className="text-title font-semibold text-fg">
            {data.medianHoursToRespond > 0 ? `${data.medianHoursToRespond} ч` : '–'}
          </div>
          <div className="text-micro text-fg-subtle mt-1">
            Норма: до {data.norms.maxHoursToRespond} ч
          </div>
        </div>

        {/* Ритм: у руководителя ежедневность важнее объёма — разбор по горячему следу и есть
            норматив 24 часа. Цель 5 из 5 рабочих дней, включая пятницу. */}
        <div className="rounded-card p-3 border" style={{ borderColor: okDays === false ? 'var(--color-danger-border)' : 'var(--color-surface-sunken)', backgroundColor: okDays === false ? 'var(--color-danger-subtle)' : 'var(--color-canvas)' }}>
          <div className="flex items-center gap-1.5 text-micro text-fg-subtle mb-1">
            <CalendarDays className="w-3.5 h-3.5" />
            Дней с разбором
            <MetricDot ok={okDays} />
          </div>
          <div className="text-title font-semibold text-fg">
            {data.reviewDays ?? 0} из 5
          </div>
          <div className="text-micro text-fg-subtle mt-1">
            Разбирать каждый рабочий день
          </div>
        </div>

        <div className="rounded-card p-3 border" style={{ borderColor: okLen === false ? 'var(--color-danger-border)' : 'var(--color-surface-sunken)', backgroundColor: okLen === false ? 'var(--color-danger-subtle)' : 'var(--color-canvas)' }}>
          <div className="flex items-center gap-1.5 text-micro text-fg-subtle mb-1">
            Ср. длина ревью
            <MetricDot ok={okLen} />
          </div>
          <div className="text-title font-semibold text-fg">
            {data.avgReviewChars}{' '}симв.
          </div>
          <div className="text-micro text-fg-subtle mt-1">
            Норма: от {data.norms.minReviewCharsAvg}
          </div>
        </div>

        <div className="rounded-card p-3 border" style={{ borderColor: okQuality === false ? 'var(--color-danger-border)' : 'var(--color-surface-sunken)', backgroundColor: okQuality === false ? 'var(--color-danger-subtle)' : 'var(--color-canvas)' }}>
          <div className="flex items-center gap-1.5 text-micro text-fg-subtle mb-1">
            Качество
            <MetricDot ok={okQuality} />
          </div>
          <div className="text-title font-semibold text-fg">
            {data.qualityPct}%
          </div>
          <div className="text-micro text-fg-subtle mt-1">
            Норма: от {data.norms.qualityThresholdPct}%
          </div>
        </div>
      </div>

      {data.overdue.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-micro font-semibold mb-2 text-danger-fg">
            Ждут вашего ревью дольше нормы ({data.overdue.length}):
          </p>
          <ul className="space-y-0.5">
            {data.overdue.slice(0, 5).map((item) => (
              <li key={item.id}>
                <Link
                  to={`/sprint/${item.sprintId}?entryId=${item.id}`}
                  className="group flex items-center justify-between gap-2 -mx-2 px-2 py-1 rounded-card text-micro text-fg-muted hover:bg-accent-subtle hover:text-fg transition-colors"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <ChevronRight className="w-3.5 h-3.5 text-border group-hover:text-accent flex-shrink-0 transition-colors" />
                    <span className="truncate">{item.managerName}</span>
                  </span>
                  <span className="text-fg-subtle group-hover:text-accent-hover flex-shrink-0 transition-colors">{item.hoursWaiting} ч</span>
                </Link>
              </li>
            ))}
            {data.overdue.length > 5 && (
              <li className="text-micro text-fg-subtle px-2 pt-0.5">+ ещё {data.overdue.length - 5} · открыть на доске спринта</li>
            )}
          </ul>
        </div>
      )}
    </Card>
  );
}
