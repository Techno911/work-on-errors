import { useState } from 'react';
import { toast } from 'sonner';
import { playbookApi } from '@/api/playbook';
import type { PlaybookCard } from '@/types';
import { Button, Input, Modal, Textarea } from '@chirkov/shell';

interface PlaybookConfirmDialogProps {
  card: PlaybookCard;
  companyId: string;
  onClose: () => void;
  onConfirmed: (card: PlaybookCard) => void;
}

export function PlaybookConfirmDialog({ card, companyId, onClose, onConfirmed }: PlaybookConfirmDialogProps) {
  const [title, setTitle] = useState(card.title);
  // Черновик от ИИ (Release 2) предзаполняет поле — РОП правит или принимает как есть,
  // ни одна карточка не попадает в методичку без его подтверждения.
  const [ruleText, setRuleText] = useState(card.draftRuleText ?? '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ruleText.trim().length < 10) {
      toast.error('Опишите правило подробнее, хотя бы одно предложение');
      return;
    }
    setLoading(true);
    try {
      const { data } = await playbookApi.confirm(companyId, card.id, { title: title.trim(), ruleText: ruleText.trim() });
      toast.success('Карточка добавлена в методичку');
      onConfirmed(data);
    } catch {
      toast.error('Не удалось сохранить карточку', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      size="md"
      open
      onClose={onClose}
      title="Добавить в методичку"
      footer={(
        <>
          <Button
            type="submit"
            form="playbook-confirm-form"
            disabled={loading}
            variant="primary"
            size="md"
          >
            {loading ? 'Сохраняем…' : 'Добавить в методичку'}
          </Button>
          <Button variant="ghost" size="md"
            type="button"
            onClick={onClose}
          >
            Отмена
          </Button>
        </>
      )}
    >
      <form id="playbook-confirm-form" onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Название</label>
          <Input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
            required
          />
        </div>

        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Как делаем у нас</label>
          <p className="text-micro text-fg-subtle mb-1.5">
            {card.draftRuleText
              ? 'Черновик от платформы: собран из ваших же разборов. Проверьте и поправьте, если нужно.'
              : 'Одно-два предложения: что менеджер должен делать в этой ситуации. Доказательства ниже уже вошли в примеры карточки.'}
          </p>
            <Textarea resize="none"
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            rows={4}
            placeholder="Например: называем вилку цены сразу и говорим, что в неё входит…"
            maxLength={4000}
            required
          />
        </div>
      </form>
    </Modal>
  );
}
