import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Mail, Send } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { companiesApi } from '@/api/companies';
import { Button, Card } from '@chirkov/shell';

type Weekly = { emails?: string[]; telegramChatIds?: string[]; confirmedByOwnerAt?: string };

/**
 * «Отчёт придёт сюда» — сверка адреса, а не настройка. Каналы проставляет трекер, но отчётность
 * у владельца собственная: он должен один раз увидеть адрес и подтвердить, иначе узнает об ошибке
 * через месяц молчания. Одна кнопка, дальше карточка не возвращается.
 *
 * Пустые каналы этой карточкой не лечатся — для них на дашборде есть отдельный оранжевый баннер
 * с подключением Telegram в один клик.
 */
export function ReportChannelsConfirmCard({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    companiesApi.getSettings(companyId)
      .then(({ data }) => {
        const wa = (data as unknown as { reportChannels?: { weeklyAccountability?: Weekly } })
          .reportChannels?.weeklyAccountability;
        setWeekly(wa ?? null);
      })
      .catch(() => setWeekly(null));
  }, [companyId]);

  const emails = weekly?.emails ?? [];
  const telegram = weekly?.telegramChatIds ?? [];
  const hasChannels = emails.length > 0 || telegram.length > 0;

  const confirm = async () => {
    setSaving(true);
    try {
      // Пишем целиком: PATCH заменяет jsonb, частичный объект затёр бы сами адреса.
      await companiesApi.update(companyId, {
        reportChannels: {
          weeklyAccountability: { ...weekly, confirmedByOwnerAt: new Date().toISOString() },
        },
      });
      setDone(true);
      toast.success('Спасибо, отчёт будет приходить по этому адресу');
    } catch {
      toast.error('Не удалось сохранить. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  if (done || !weekly || !hasChannels || weekly.confirmedByOwnerAt) return null;

  return (
    <Card padding="none" className="mb-6">
      <div className="px-5 py-4">
        <p className="text-body font-semibold text-fg mb-1">Недельный отчёт будет приходить сюда</p>
        <p className="text-body text-fg-muted mb-3">
          Каждый понедельник в 09:00: кто разбирает звонки и переписки, где команда теряет клиентов.
          Проверьте адрес, чтобы сводка не ушла не туда.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5 mb-4">
          {telegram.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-body text-fg-muted">
              <Send className="w-3.5 h-3.5 text-fg-disabled" />
              {/* Численный chat_id владельцу ничего не говорит — показываем его как свой чат. */}
              {telegram.map(t => (t.startsWith('@') ? t : 'ваш Telegram')).join(', ')}
            </span>
          )}
          {emails.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-body text-fg-muted">
              <Mail className="w-3.5 h-3.5 text-fg-disabled" />
              {emails.join(', ')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={confirm}
            disabled={saving}
            icon={<Check />}
          >
            {saving ? 'Сохраняем…' : 'Всё верно'}
          </Button>
          <Button
            type="button"
            variant="link"
            size="md"
            onClick={() => navigate('/settings?tab=norms&section=report-channels')}
          >
            Изменить адрес
          </Button>
        </div>
      </div>
    </Card>
  );
}
