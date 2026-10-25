import { useState } from 'react';
import { Button } from '@chirkov/shell';
import type { Entry } from '@/types';
import { entriesApi } from '@/api/entries';
import { useAuthStore } from '@/stores/authStore';

function formatStamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? `сегодня, ${time}`
    : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}, ${time}`;
}

export interface ReviewConfirmBlockProps {
  entry: Entry;
  onUpdate: (entry: Entry) => void;
}

/**
 * Личная отметка чтения разбора (review-reread-confirm, принятый визуал).
 * Менеджер подтверждает у своей записи явным действием; РОП/owner и «Глазами»
 * видят то же состояние без действия (сервер отдельно отклоняет 403).
 * Отметка — факт чтения, не доказательство применения.
 *
 * Применение ответа — паттерн задачи 2: sessionVersion + автор запроса через
 * getState после await; поздний ответ чужой сессии в карточку не пишет.
 * Сохранение только после успеха; ошибка не меняет состояние и даёт повтор.
 */
export function ReviewConfirmBlock({ entry, onUpdate }: ReviewConfirmBlockProps) {
  const user = useAuthStore(s => s.user);
  const impersonator = useAuthStore(s => s.impersonator);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const canAct =
    !!user &&
    user.role === 'manager' &&
    !impersonator &&
    entry.managerId === user.id &&
    entry.status === 'reviewed' &&
    !!entry.reviewText;

  const hasConfirm = !!entry.reviewConfirmedAt;
  const editedAfter =
    hasConfirm &&
    !!entry.reviewConfirmedHash &&
    !!entry.reviewTextHash &&
    entry.reviewConfirmedHash !== entry.reviewTextHash;

  const actionLabel = !hasConfirm ? 'Прочитал' : editedAfter ? 'Прочитал дополнение' : 'Перечитал сейчас';

  const statusText = editedAfter
    ? 'РОП дополнил разбор после вашего подтверждения'
    : !hasConfirm
      ? 'Пока нет отметки'
      : entry.reviewRereadAt
        ? `Перечитал ${formatStamp(entry.reviewRereadAt)}`
        : `Последнее подтверждение: ${formatStamp(entry.reviewConfirmedAt!)}`;

  const confirm = async () => {
    const atStart = useAuthStore.getState();
    const author = atStart.user;
    const expected = entry.reviewTextHash;
    if (!canAct || busy || !author || !expected) return;
    setBusy(true);
    setError(false);
    try {
      const { data } = await entriesApi.confirmReview(entry.id, expected, entry.reviewRereadAt ?? null);
      if (!data?.reviewConfirmedHash) {
        setError(true);
        return;
      }
      const now = useAuthStore.getState();
      const sameSession = now.sessionVersion === atStart.sessionVersion;
      const sameUser = !!now.user && now.user.id === author.id && now.user.role === author.role;
      if (!sameSession || !sameUser || now.impersonator) return;
      onUpdate({ ...entry, ...data });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-2 border-t border-border">
      <p className="text-micro font-semibold text-fg-muted mb-1 uppercase tracking-overline">Подтверждение менеджера</p>
      <p className="text-body text-fg-muted mb-2">{statusText}</p>
      {error && (
        <p className="text-micro text-danger mb-2">Не удалось сохранить отметку. Повторить</p>
      )}
      <div className="review-confirm-actions flex items-center gap-4 flex-wrap">
        {canAct && (
          <Button type="button" variant="link" size="sm" disabled={busy} onClick={confirm}>
            {busy ? 'Сохраняем…' : actionLabel}
          </Button>
        )}
      </div>
      <p className="text-micro text-fg-muted mt-2">Личная отметка о чтении. Применение рекомендации проверяется отдельно</p>
    </div>
  );
}
