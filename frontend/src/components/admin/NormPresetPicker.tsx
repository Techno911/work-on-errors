import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SlidersHorizontal } from 'lucide-react';
import { companiesApi } from '@/api/companies';
import { adminApi } from '@/api/admin';
import { Badge, Card, ListRow } from '@chirkov/shell';

type PresetName = 'soft' | 'standard' | 'strict';
type NormPreset = { name: PresetName; label: string; tone: string; data: Record<string, unknown> };

// Те же ключи, по которым режим подсвечивается активным в настройках владельца.
const MATCH_KEYS = [
  'callsPerWeek', 'chatsPerWeek', 'thresholdGoodCalls', 'thresholdGreatCalls',
  'thresholdGoodChats', 'thresholdGreatChats', 'minSelfReviewCorrectChars',
  'minSelfReviewImproveChars', 'minSelfReviewSuggestionsChars', 'minReviewChars',
];

/**
 * Нормативы команды в карточке компании: их задаёт трекер (он видел диагностику и знает темп),
 * но применить режим раньше мог только владелец из своих Настроек, куда трекер не попадает.
 */
export function NormPresetPicker({ companyId, onApplied }: { companyId: string; onApplied?: () => void }) {
  const [presets, setPresets] = useState<NormPreset[]>([]);
  const [current, setCurrent] = useState<Record<string, unknown> | null>(null);
  const [applying, setApplying] = useState<PresetName | null>(null);

  const loadCurrent = () => {
    companiesApi.getSettings(companyId)
      .then(({ data }) => setCurrent(data as unknown as Record<string, unknown>))
      .catch(() => setCurrent(null));
  };

  useEffect(() => {
    companiesApi.getNormPresets().then(({ data }) => setPresets(data)).catch(() => setPresets([]));
    loadCurrent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const active = current
    ? presets.find(p => MATCH_KEYS.every(k => current[k] === p.data[k]))?.name ?? null
    : null;

  const apply = async (name: PresetName) => {
    setApplying(name);
    try {
      const { data } = await adminApi.applyNormPreset(companyId, name);
      toast.success(`Нормативы переключены на режим «${data.label}»`);
      loadCurrent();
      onApplied?.();
    } catch {
      toast.error('Не удалось применить режим', { duration: Infinity });
    } finally {
      setApplying(null);
    }
  };

  if (!presets.length) return null;

  return (
    <Card padding="md">
      <div className="flex items-center gap-2 mb-1">
        <SlidersHorizontal className="w-4 h-4 text-fg-subtle" />
        <h2 className="text-body-lg font-semibold text-fg">Нормативы команды</h2>
      </div>
      <p className="text-body text-fg-muted mb-4">
        Темп разборов и требования к тексту. Ставьте по факту первых недель: если команда не успевает,
        мягче, если идёт легко, строже. Владелец видит эти же режимы в своих настройках.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 rounded-block bg-canvas p-3">
        {presets.map((p) => (
          <ListRow
            key={p.name}
            type="button"
            tone={active === p.name ? 'accent' : 'plain'}
            aria-pressed={active === p.name}
            onClick={() => apply(p.name)}
            disabled={applying !== null}
          >
            <span className="flex flex-col items-start gap-0.5 w-full">
              <span className="flex items-center justify-between gap-2 w-full">
                <span className="font-semibold text-body text-fg">
                  {applying === p.name ? 'Применяем…' : p.label}
                </span>
                {active === p.name && applying === null && (
                  <Badge tone="accent">Активен</Badge>
                )}
              </span>
              <span className="text-micro text-fg-subtle">{p.tone}</span>
            </span>
          </ListRow>
        ))}
      </div>
    </Card>
  );
}
