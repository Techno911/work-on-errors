import { useState, useEffect } from 'react';
import { gamificationApi } from '@/api/gamification';
import type { GamificationConfig, XpSettings, AchievementSettings } from '@/types';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button, Input, Card } from '@chirkov/shell';

interface Props {
  companyId: string;
}

export function GamificationSettingsPanel({ companyId }: Props) {
  const [config, setConfig] = useState<GamificationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    gamificationApi.getConfig(companyId)
      .then(r => setConfig(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [companyId]);

  const updateXp = (key: keyof XpSettings, value: number) => {
    setConfig(prev => prev ? { ...prev, xpSettings: { ...prev.xpSettings, [key]: value } } : prev);
  };

  const updateAch = (key: keyof AchievementSettings, value: number) => {
    setConfig(prev => prev ? { ...prev, achievementSettings: { ...prev.achievementSettings, [key]: value } } : prev);
  };

  const save = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await gamificationApi.updateConfig(companyId, config);
      toast.success('Настройки геймификации сохранены');
    } catch {
      toast.error('Не удалось сохранить', { duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="animate-pulse h-40 bg-surface-sunken rounded-card" />;
  if (!config) return null;

  return (
    <Card padding="md" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-body-lg font-semibold text-fg">Настройки геймификации</h2>
          <p className="text-micro text-fg-subtle mt-0.5">Очки опыта за действия и пороги достижений</p>
        </div>
        <Button
          onClick={save}
          disabled={saving}
          variant="primary"
          size="md"
          icon={<Save />}
        >
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
      </div>

      {/* XP за действия */}
      <div>
        <h3 className="text-body font-semibold text-fg-muted mb-3">Очки опыта (XP) за действия</h3>
        <div className="space-y-3">
          {([
            { key: 'entrySubmitted' as keyof XpSettings, label: 'Загрузил запись в срок', emoji: '📤' },
            { key: 'selfReviewComplete' as keyof XpSettings, label: 'Заполнил самоанализ подробно', emoji: '📝' },
            { key: 'reviewReceived' as keyof XpSettings, label: 'Получил ревью от РОПа', emoji: '✅' },
            { key: 'reviewNoErrors' as keyof XpSettings, label: 'Бонус: ревью без ошибок', emoji: '🎯' },
            { key: 'weeklyGoodZone' as keyof XpSettings, label: 'Неделя в зоне «Молодец»', emoji: '👍' },
            { key: 'weeklyGreatZone' as keyof XpSettings, label: 'Неделя в зоне «Красавчик»', emoji: '🏆' },
            { key: 'streakBonus' as keyof XpSettings, label: 'Бонус каждые 4 недели серии', emoji: '🔥' },
          ] as const).map(({ key, label, emoji }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2 border-b border-canvas last:border-0">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-body-lg">{emoji}</span>
                <p className="text-body text-fg-muted truncate">{label}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-micro text-fg-subtle">+</span>
                <div className="w-24 text-center">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={config.xpSettings[key]}
                    onChange={e => updateXp(key, Math.max(0, Math.min(100, Number(e.target.value))))}
                  />
                </div>
                <span className="text-micro text-fg-subtle w-5">XP</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Пороги ачивок */}
      <div>
        <h3 className="text-body font-semibold text-fg-muted mb-3">Пороги достижений</h3>
        <div className="space-y-3">
          {([
            { key: 'sniperThreshold' as keyof AchievementSettings, label: '🎯 Снайпер: ревью без ошибок подряд', unit: 'раз' },
            { key: 'writerThreshold' as keyof AchievementSettings, label: '📝 Писатель: подробных самоанализов подряд', unit: 'раз' },
            { key: 'great3xThreshold' as keyof AchievementSettings, label: '👑 Красавчик ×N: недель «Красавчик» подряд', unit: 'нед.' },
            { key: 'streak7Threshold' as keyof AchievementSettings, label: '«7 недель подряд»: недель серии', unit: 'нед.' },
            { key: 'streak30Threshold' as keyof AchievementSettings, label: '💎 Легенда: недель серии', unit: 'нед.' },
          ] as const).map(({ key, label, unit }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2 border-b border-canvas last:border-0">
              <p className="text-body text-fg-muted flex-1 min-w-0">{label}</p>
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="w-24 text-center">
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={config.achievementSettings[key]}
                    onChange={e => updateAch(key, Math.max(1, Math.min(365, Number(e.target.value))))}
                  />
                </div>
                <span className="text-micro text-fg-subtle w-8">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
