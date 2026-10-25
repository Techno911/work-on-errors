import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@chirkov/shell';
import type { Entry } from '@/types';
import { entriesApi } from '@/api/entries';
import { useAuthStore } from '@/stores/authStore';
import { ReviewConfirmBlock } from './ReviewConfirmBlock';

const PAGE = 5;

/**
 * «Предыдущие разборы РОПа» — раскрываемый возврат к обратной связи перед новой
 * записью (принятый визуал). Последние 5 разобранных записей менеджера по всем
 * спринтам, «Показать ещё» догружает по 5. Пожизненного долга нет: блок
 * сворачиваемый, «Продолжить запись» доступна всегда, открытие фактов не создаёт.
 * У менеджера без разборов блок не показывается.
 */
export function PreviousReviewsBlock() {
  const user = useAuthStore(s => s.user);
  const impersonator = useAuthStore(s => s.impersonator);
  const navigate = useNavigate();
  const [items, setItems] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  const isManager = !!user && user.role === 'manager' && !impersonator;

  useEffect(() => {
    if (!isManager) return;
    entriesApi.getRecentReviews({ limit: PAGE + 1, offset: 0, order: 'reviewedAt', requireText: true })
      .then(({ data }) => {
        setItems(data.slice(0, PAGE));
        setHasMore(data.length > PAGE);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [isManager]);

  const loadMore = async () => {
    setMoreLoading(true);
    try {
      const { data } = await entriesApi.getRecentReviews({ limit: PAGE + 1, offset: items.length, order: 'reviewedAt', requireText: true });
      setItems(prev => [...prev, ...data.slice(0, PAGE)]);
      setHasMore(data.length > PAGE);
    } finally {
      setMoreLoading(false);
    }
  };

  if (!isManager || (loaded && items.length === 0)) return null;

  const patchItem = (updated: Entry) =>
    setItems(prev => prev.map(e => (e.id === updated.id ? { ...e, ...updated } : e)));

  return (
    <div className="mb-5 rounded-card bg-accent-subtle p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-body font-semibold text-fg">Предыдущие разборы РОПа</p>
        <div className="review-confirm-actions flex items-center gap-3">
          {items.length > 0 && !open && (
            <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)}>
              Открыть разборы
            </Button>
          )}
          {open && (
            <Button type="button" variant="link" size="sm" onClick={() => setOpen(false)}>
              Продолжить запись
            </Button>
          )}
        </div>
      </div>
      <p className="text-micro text-fg-muted mt-1">Вернитесь к обратной связи перед самоанализом</p>

      {open && (
        <ul className="mt-3 space-y-3">
          {items.map(e => (
            <li key={e.id} className="rounded-card bg-surface p-3">
              <div className="review-confirm-actions">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => navigate(`/sprint/${e.sprintId}?entryId=${e.id}`)}
                >
                  Разбор от {e.reviewedAt ? new Date(e.reviewedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : 'даты нет'} · запись #{e.entryNumber}
                </Button>
              </div>
              <p className="text-body text-fg-muted whitespace-pre-line mt-2">{e.reviewText}</p>
              <ReviewConfirmBlock entry={e} onUpdate={patchItem} />
            </li>
          ))}
          {hasMore && (
            <li className="review-confirm-actions">
              <Button type="button" variant="link" size="sm" disabled={moreLoading} onClick={loadMore}>
                {moreLoading ? 'Загружаем…' : 'Показать ещё'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
