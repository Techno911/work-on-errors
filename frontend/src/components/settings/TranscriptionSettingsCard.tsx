import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { companiesApi } from '@/api/companies';
import { transcriptionApi } from '@/api/transcription';
import type { TranscriptionSettingsData, TranscriptionUsage } from '@/types';
import { Switch, Input, Card } from '@chirkov/shell';

/**
 * Транскрипция звонков. Тумблер и лимит — только superadmin (фича тратит минуты
 * по договору платформы). Владелец видит расход минут за месяц read-only.
 * Сохраняется сразу, отдельно от draft-настроек таба.
 */
export function TranscriptionSettingsCard({
  companyId,
  value,
  isSuperadmin,
}: {
  companyId: string;
  value: TranscriptionSettingsData | null | undefined;
  isSuperadmin: boolean;
}) {
  const [settings, setSettings] = useState<TranscriptionSettingsData>(
    value ?? { enabled: false, monthlyMinutesLimit: 300 },
  );
  const [usage, setUsage] = useState<TranscriptionUsage | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (value) setSettings(value);
  }, [value]);

  useEffect(() => {
    if (!companyId || !(value?.enabled || isSuperadmin)) return;
    transcriptionApi.getUsage(isSuperadmin ? companyId : undefined)
      .then(({ data }) => setUsage(data))
      .catch(() => undefined);
  }, [companyId, value?.enabled, isSuperadmin]);

  // Владельцу без включённой фичи карточку не показываем вообще
  if (!isSuperadmin && !value?.enabled) return null;

  const save = async (next: TranscriptionSettingsData) => {
    setSettings(next);
    setSaving(true);
    try {
      await companiesApi.update(companyId, { transcription: next } as unknown as Record<string, unknown>);
      toast.success(next.enabled ? 'Транскрипция включена' : 'Транскрипция выключена');
    } catch {
      toast.error('Не удалось сохранить настройки транскрипции', { duration: Infinity });
      setSettings(settings);
    } finally {
      setSaving(false);
    }
  };

  const limit = usage?.limitMinutes ?? settings.monthlyMinutesLimit;
  const used = usage?.usedMinutes ?? 0;
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const MONTHS_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
  const monthName = MONTHS_PREP[new Date().getMonth()];

  return (
    <Card padding="md">
      <h2 className="text-body-lg font-semibold text-fg mb-1">Транскрипция звонков</h2>
      <p className="text-micro text-fg-subtle mb-4">
        Менеджер загружает аудиофайл звонка, платформа сама превращает его в текст диалога с разделением голосов.
      </p>

      {isSuperadmin && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2 border-b border-border mb-4">
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-body font-medium text-fg">Включить для этой компании</p>
            <p className="text-micro text-fg-subtle mt-0.5">Минуты распознавания списываются с договора «ЧиП».</p>
          </div>
          <Switch
            value={settings.enabled}
            labels={['Включено', 'Выключено']}
            aria-label="Включить для этой компании"
            disabled={saving}
            onChange={(next) => save({ ...settings, enabled: next })}
          />
        </div>
      )}

      {isSuperadmin && settings.enabled && (
        <div className="flex items-center gap-3 mb-4">
          <label className="text-body text-fg-muted">Лимит минут в месяц</label>
          <div className="w-24">
            <Input
              type="number"
              min={0}
              value={settings.monthlyMinutesLimit ?? 0}
              onChange={e => setSettings({ ...settings, monthlyMinutesLimit: Math.max(0, parseInt(e.target.value) || 0) })}
              onBlur={() => save(settings)}
            />
          </div>
        </div>
      )}

      {(settings.enabled || used > 0) && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-body text-fg-muted">
              Использовано в {monthName}: <span className="font-semibold">{used}</span>{limit ? ` из ${limit} мин` : ' мин'}
            </p>
            {limit !== null && pct >= 90 && (
              <span className="text-micro font-medium text-warning-fg">Лимит почти исчерпан</span>
            )}
          </div>
          {limit !== null && (
            <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: pct >= 90 ? 'var(--color-warning)' : 'var(--color-accent)' }}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
