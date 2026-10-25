import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { companiesApi } from '@/api/companies';
import type { UpdateCompanySettingsDto } from '@/types';
import { Badge, ListRow } from '@chirkov/shell';

type PresetName = 'soft' | 'standard' | 'strict';

type NormPreset = { name: PresetName; label: string; tone: string; data: Record<string, unknown> };

interface Props {
  companyId: string;
  onApplied?: () => void;
  // Текущие настройки компании — чтобы подсветить фактически активный пресет
  current?: Record<string, unknown> | null;
}

// Пресет считается активным, когда все его ключевые значения совпадают с настройками компании
const MATCH_KEYS: (keyof UpdateCompanySettingsDto)[] = [
  'callsPerWeek', 'chatsPerWeek', 'thresholdGoodCalls', 'thresholdGreatCalls',
  'thresholdGoodChats', 'thresholdGreatChats', 'minSelfReviewCorrectChars',
  'minSelfReviewImproveChars', 'minSelfReviewSuggestionsChars', 'minReviewChars',
];

function detectActive(presets: NormPreset[], current?: Record<string, unknown> | null): PresetName | null {
  if (!current) return null;
  for (const p of presets) {
    if (MATCH_KEYS.every(k => current[k as string] === p.data[k as string])) return p.name;
  }
  return null;
}

export function SettingsPresets({ companyId, onApplied, current }: Props) {
  const [applying, setApplying] = useState<PresetName | null>(null);
  const [applied, setApplied] = useState<PresetName | null>(null);
  // Значения режимов приходят с бэка (norm-presets.ts) — там же их берёт трекер, чтобы один
  // и тот же «Стандартный» не разошёлся между его карточкой и настройками владельца.
  const [presets, setPresets] = useState<NormPreset[]>([]);
  useEffect(() => {
    companiesApi.getNormPresets().then(({ data }) => setPresets(data)).catch(() => setPresets([]));
  }, []);
  // Активный режим: только что применённый или совпавший по значениям (переживает перезагрузку)
  const active = applied ?? detectActive(presets, current);

  // Один клик = применить сразу. Значения видны в полях ниже, любое можно поправить руками.
  const apply = async (name: PresetName) => {
    const preset = presets.find(p => p.name === name);
    if (!preset) return;
    setApplying(name);
    try {
      await companiesApi.update(companyId, preset.data);
      setApplied(name);
      toast.success(`Пресет «${preset.label}» применён, значения в полях ниже обновились.`);
      onApplied?.();
    } catch {
      toast.error('Не удалось применить пресет', { duration: Infinity });
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="bg-accent-subtle border border-accent-muted rounded-card p-5 mb-6">
      <h3 className="text-body font-semibold text-fg mb-1">Быстрый старт</h3>
      <p className="text-micro text-fg-muted mb-4">
        Один клик: платформа подставит подходящие значения во все поля ниже. Любое поле можно изменить после.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {presets.map((p) => {
          const name = p.name;
          const isApplying = applying === name;
          const isApplied = active === name;
          return (
            <ListRow
              key={name}
              type="button"
              onClick={() => apply(name)}
              disabled={applying !== null}
              tone={isApplied ? 'accent' : 'plain'}
              aria-pressed={isApplied}
            >
              <span className="flex flex-col items-start gap-0.5 w-full">
                <span className="flex items-center justify-between gap-2 w-full">
                  <span className="font-semibold text-body text-fg">
                    {isApplying ? 'Применяем…' : p.label}
                  </span>
                  {isApplied && !isApplying && (
                    <Badge tone="accent">Активен ✓</Badge>
                  )}
                </span>
                <span className="text-micro text-fg-subtle">{p.tone}</span>
              </span>
            </ListRow>
          );
        })}
      </div>
    </div>
  );
}
