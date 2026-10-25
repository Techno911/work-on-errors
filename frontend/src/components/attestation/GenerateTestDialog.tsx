import { useState } from 'react';
import { toast } from 'sonner';
import { attestationApi } from '@/api/attestation';
import type { AttestationTest } from '@/types';
import { Button, Input, Modal } from '@chirkov/shell';

interface GenerateTestDialogProps {
  companyId: string;
  onClose: () => void;
  onCreated: (test: AttestationTest) => void;
}

export function GenerateTestDialog({ companyId, onClose, onCreated }: GenerateTestDialogProps) {
  const [title, setTitle] = useState('');
  const [passingScorePercent, setPassingScorePercent] = useState(75);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await attestationApi.generateTest(companyId, {
        title: title.trim() || undefined,
        passingScorePercent,
      });
      toast.success('Платформа собирает вопросы из активных карточек методички');
      onCreated(data);
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || 'Не удалось создать тест', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Назначить аттестацию"
      footer={(
        <>
          <Button
            type="submit"
            form="generate-test-form"
            variant="primary"
            size="md"
            disabled={loading}
          >
            {loading ? 'Создаём…' : 'Собрать вопросы'}
          </Button>
          <Button variant="ghost" size="md" type="button" onClick={onClose}>
            Отмена
          </Button>
        </>
      )}
    >
      <form id="generate-test-form" onSubmit={handleSubmit} className="space-y-4">
        <p className="text-body text-fg-subtle">
          Вопросы соберутся из активных карточек методички: на знание, на ситуацию и рабочая проба
          на каждое правило, без вариантов ответа. Это займёт пару минут, тест появится
          черновиком, когда будет готов.
        </p>
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Название (необязательно)</label>
          <Input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: Аттестация по методичке №2"
            maxLength={255}
          />
        </div>
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Проходной балл</label>
          <div className="flex items-center gap-2">
            <div className="w-24">
              <Input
                type="number"
                min={50}
                max={100}
                value={passingScorePercent}
                onChange={(e) => setPassingScorePercent(Number(e.target.value))}
              />
            </div>
            <span className="text-body text-fg-subtle">% (75%, как в стандарте обучения)</span>
          </div>
        </div>
      </form>
    </Modal>
  );
}
