import { useState } from 'react';

const RU_TIMEZONES = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { value: 'Europe/Moscow', label: 'Москва (UTC+3)' },
  { value: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (UTC+5)' },
  { value: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { value: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { value: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { value: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { value: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { value: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
  { value: 'Asia/Kamchatka', label: 'Камчатка (UTC+12)' },
];
import { toast } from 'sonner';
import { adminApi } from '@/api/admin';
import { Phone, MessageSquare } from 'lucide-react';
import { Button, Checkbox, Input, Modal, Select } from '@chirkov/shell';

interface CreateCompanyModalProps {
  onClose: () => void;
  onCreated: (companyId: string) => void;
}

export function CreateCompanyModal({ onClose, onCreated }: CreateCompanyModalProps) {
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState('Europe/Moscow');
  const [callsEnabled, setCallsEnabled] = useState(true);
  const [chatsEnabled, setChatsEnabled] = useState(true);
  const [callsPerWeek, setCallsPerWeek] = useState(5);
  const [chatsPerWeek, setChatsPerWeek] = useState(5);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      const { data } = await adminApi.createCompany({
        name: name.trim(),
        timezone,
        callsEnabled,
        chatsEnabled,
        callsPerWeek,
        chatsPerWeek,
      });
      toast.success('Компания создана');
      // Сразу в карточку компании — весь порядок онбординга (договор → оферта → команда)
      // грамотно ведёт чек-лист там; отдельный промежуточный экран-пуш не нужен.
      onCreated(data.id);
    } catch {
      toast.error('Не удалось создать компанию', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Новая компания"
      footer={(
        <>
          <Button
            type="submit"
            form="create-company-form"
            disabled={loading || !name.trim()}
            variant="primary"
            size="md"
          >
            {loading ? 'Создаём…' : 'Создать компанию'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            type="button"
            onClick={onClose}
          >
            Отмена
          </Button>
        </>
      )}
    >
      <form id="create-company-form" onSubmit={handleSubmit} className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Название</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название компании..."
            required
          />
        </div>

        {/* Timezone: граница недели, дедлайны и утренние отчёты — по местному времени клиента */}
        <div>
          <label className="block text-body font-medium text-fg-muted mb-1">Часовой пояс клиента</label>
          <Select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {RU_TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </Select>
        </div>

        {/* Entry types */}
        <div>
          <label className="block text-body font-medium text-fg-muted mb-2">Типы записей</label>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <Checkbox
                label={<span className="flex items-center gap-1.5"><Phone className="w-4 h-4 text-fg-subtle" />Звонки</span>}
                checked={callsEnabled}
                onChange={(e) => setCallsEnabled(e.target.checked)}
              />
              {callsEnabled && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-micro text-fg-subtle">Норматив:</span>
                  <div className="w-14">
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={callsPerWeek}
                      onChange={(e) => setCallsPerWeek(Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Checkbox
                label={<span className="flex items-center gap-1.5"><MessageSquare className="w-4 h-4 text-fg-subtle" />Переписки</span>}
                checked={chatsEnabled}
                onChange={(e) => setChatsEnabled(e.target.checked)}
              />
              {chatsEnabled && (
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-micro text-fg-subtle">Норматив:</span>
                  <div className="w-14">
                    <Input
                      type="number"
                      min="1"
                      max="50"
                      value={chatsPerWeek}
                      onChange={(e) => setChatsPerWeek(Number(e.target.value))}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </form>
    </Modal>
  );
}
