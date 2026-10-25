import { useState } from 'react';
import { toast } from 'sonner';
import { playbookApi } from '@/api/playbook';
import { Button, Input, Modal, Textarea } from '@chirkov/shell';

interface PlaybookManualCardDialogProps {
  companyId: string;
  onClose: () => void;
  onCreated: () => void;
}

export function PlaybookManualCardDialog({ companyId, onClose, onCreated }: PlaybookManualCardDialogProps) {
  const [title, setTitle] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setLoading(true);
    try {
      await playbookApi.createManual(companyId, { title: title.trim(), ruleText: ruleText.trim() || undefined });
      toast.success(ruleText.trim() ? 'Карточка добавлена в методичку' : 'Черновик карточки создан');
      onCreated();
    } catch {
      toast.error('Не удалось создать карточку', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      size="md"
      open
      onClose={onClose}
      title="Своя карточка"
      footer={(
        <>
          <Button
            type="submit"
            form="playbook-manual-form"
            disabled={loading || !title.trim()}
            variant="primary"
            size="md"
          >
            {loading ? 'Сохраняем…' : 'Создать'}
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
      <form id="playbook-manual-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-micro text-fg-subtle">
          Для ситуации, которая не сводится к одному тегу разбора: платформа не найдёт её сама, добавьте вручную.
        </p>
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Название</label>
          <Input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: работа с недовольным клиентом"
            maxLength={255}
            required
          />
        </div>
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Как делаем у нас (необязательно сейчас)</label>
            <Textarea resize="none"
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            rows={3}
            maxLength={4000}
          />
        </div>
      </form>
    </Modal>
  );
}
