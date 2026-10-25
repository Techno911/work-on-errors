import { useState } from 'react';
import { toast } from 'sonner';
import { playbookApi } from '@/api/playbook';
import type { PlaybookCard } from '@/types';
import { Button, Modal, Textarea } from '@chirkov/shell';

interface PlaybookDismissDialogProps {
  card: PlaybookCard;
  companyId: string;
  /** Отклонить кандидата (из очереди) или архивировать уже опубликованную карточку — текст меняется. */
  mode: 'dismiss' | 'archive';
  onClose: () => void;
  onDone: () => void;
}

export function PlaybookDismissDialog({ card, companyId, mode, onClose, onDone }: PlaybookDismissDialogProps) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      if (mode === 'dismiss') {
        await playbookApi.dismiss(companyId, card.id, { reason: reason.trim() || undefined });
        toast.success('Кандидат отклонён');
      } else {
        await playbookApi.archive(companyId, card.id, { reason: reason.trim() || undefined });
        toast.success('Карточка убрана из методички');
      }
      onDone();
    } catch {
      toast.error('Не удалось сохранить решение', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'dismiss' ? 'Это не системная ошибка' : 'Убрать из методички';
  const hint = mode === 'dismiss'
    ? 'Совпадение или разовый случай: карточка не появится в методичке. Если повторится ещё несколько раз, платформа поднимет её снова.'
    : 'Правило больше не актуально для команды. Карточка перестанет отображаться в методичке.';

  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={(
        <>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            variant="primary"
            size="md"
          >
            {loading ? 'Сохраняем…' : 'Подтвердить'}
          </Button>
          <Button variant="ghost" size="md"
            onClick={onClose}
          >
            Отмена
          </Button>
        </>
      )}
    >
      <div className="space-y-4">
        <p className="text-body text-fg-subtle">{hint}</p>
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Причина (необязательно)</label>
            <Textarea resize="none"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Коротко, для истории решения…"
            maxLength={1000}
          />
        </div>
      </div>
    </Modal>
  );
}
