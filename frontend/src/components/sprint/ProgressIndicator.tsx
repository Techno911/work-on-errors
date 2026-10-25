import { useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { Entry, CompanySettings } from '@/types';
import { Badge, Notice } from '@chirkov/shell';

type Zone = 'below' | 'good' | 'great';

function calcZone(count: number, good: number, great: number): Zone {
  if (count >= great) return 'great';
  if (count >= good) return 'good';
  return 'below';
}

const ZONE_COLORS: Record<Zone, string> = {
  below: 'var(--color-danger)',  // red
  good:  'var(--color-success)',  // green (success) — NOT brand orange
  great: 'var(--color-warning)',  // gold
};

const ZONE_LABELS: Record<Zone, string> = {
  below: 'Ниже нормы',
  good:  'Норма',
  great: 'Сильная неделя',
};

const ZONE_BADGE_COLORS: Record<Zone, 'danger' | 'success' | 'warning'> = {
  below: 'danger',
  good: 'success',
  great: 'warning',
};

interface ThresholdBarProps {
  count: number;
  thresholdGood: number;
  thresholdGreat: number;
  label: string;
  icon: string;
  enabled: boolean;
}

function ThresholdBar({ count, thresholdGood, thresholdGreat, label, icon, enabled }: ThresholdBarProps) {
  if (!enabled) return null;

  const zone = calcZone(count, thresholdGood, thresholdGreat);
  const max = Math.max(thresholdGreat, count); // never shrink bar beyond max threshold
  const fillPct = Math.min(100, Math.round((count / max) * 100));
  const goodPct = Math.round((thresholdGood / max) * 100);
  const greatPct = Math.round((thresholdGreat / max) * 100);
  const barColor = ZONE_COLORS[zone];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-body text-fg-muted">
          <span>{icon}</span>
          <span>{label}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-body font-semibold text-fg">{count}</span>
          <Badge tone={ZONE_BADGE_COLORS[zone]}>{ZONE_LABELS[zone]}</Badge>
        </span>
      </div>

      {/* Bar with threshold markers */}
      <div className="relative h-2.5 bg-surface-sunken rounded-full overflow-visible">
        {/* Fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{ width: `${fillPct}%`, backgroundColor: barColor }}
        />
        {/* Good marker (dashed line) */}
        <div
          className="absolute inset-y-0 w-0.5 bg-fg-disabled opacity-60"
          style={{ left: `${goodPct}%`, borderRight: '2px dashed var(--color-fg-disabled)', width: 0 }}
        />
        {/* Great marker */}
        <div
          className="absolute inset-y-0 w-0.5 bg-fg-muted opacity-70"
          style={{ left: `${greatPct}%`, borderRight: '2px dashed var(--color-fg-subtle)', width: 0 }}
        />
      </div>

      {/* Threshold labels */}
      <div className="relative h-3 text-micro text-fg-subtle">
        <span className="absolute" style={{ left: `${goodPct}%`, transform: 'translateX(-50%)' }}>
          {thresholdGood}
        </span>
        <span className="absolute" style={{ left: `${greatPct}%`, transform: 'translateX(-50%)' }}>
          {thresholdGreat}
        </span>
      </div>
    </div>
  );
}

/** Бейдж разгонной (стартовой) недели: запуск не с понедельника, пороги на старте снижены. */
function RampUpChip() {
  return (
    <Notice tone="warning" title="Разгонная неделя.">
      Запуск не с понедельника: на этот короткий старт пороги снижены, а неделя не идёт в сравнение. Полная норма со следующего понедельника.
    </Notice>
  );
}

interface ProgressIndicatorProps {
  entries: Entry[];
  settings?: CompanySettings | null;
  /** Legacy props for backward compat */
  callTarget?: number;
  chatTarget?: number;
  callsEnabled?: boolean;
  chatsEnabled?: boolean;
  /** Разгонная неделя: множитель порогов (0..1) с backend; при <1 пороги урезаны, показываем бейдж. */
  rampUpFactor?: number;
  /** false, когда пояснение о разгонной неделе уже показано выше на уровне команды. */
  showRampUpNote?: boolean;
}

// Урезание порога под разгонную неделю (зеркалит scaleThreshold на бэке): минимум 1, чтобы зона достижима.
function scaleThreshold(threshold: number, factor: number): number {
  return factor >= 1 ? threshold : Math.max(1, Math.round(threshold * factor));
}

export function ProgressIndicator({
  entries,
  settings,
  callTarget = 5,
  chatTarget = 5,
  callsEnabled = true,
  chatsEnabled = true,
  rampUpFactor = 1,
  showRampUpNote = true,
}: ProgressIndicatorProps) {
  // ─── Hooks строго на верхнем уровне ────────────────────────────────────────
  const congratsShown = useRef(false);

  const callsOn = settings ? settings.callsEnabled : callsEnabled;
  const chatsOn = settings ? settings.chatsEnabled : chatsEnabled;
  const isRampUp = rampUpFactor < 1;

  const thresholdGoodCalls  = scaleThreshold(settings?.thresholdGoodCalls  ?? callTarget, rampUpFactor);
  const thresholdGoodChats  = scaleThreshold(settings?.thresholdGoodChats  ?? chatTarget, rampUpFactor);
  const thresholdGreatCalls = scaleThreshold(settings?.thresholdGreatCalls ?? Math.round(callTarget * 1.5), rampUpFactor);
  const thresholdGreatChats = scaleThreshold(settings?.thresholdGreatChats ?? Math.round(chatTarget * 1.5), rampUpFactor);

  // Прогресс менеджера: записи отправленные на ревью OR уже проверенные
  // Менеджер сделал свою работу в момент отправки — это его KPI
  const callCount = entries.filter(e => e.type === 'call' && ['submitted', 'reviewed'].includes(e.status as string)).length;
  const chatCount = entries.filter(e => e.type === 'chat' && ['submitted', 'reviewed'].includes(e.status as string)).length;

  const useSimpleBar = !settings?.thresholdGoodCalls;
  const totalTarget = useSimpleBar ? (callsOn ? callTarget : 0) + (chatsOn ? chatTarget : 0) : 0;
  const done = callCount + chatCount;
  const percent = useSimpleBar && totalTarget > 0 ? Math.round((done / totalTarget) * 100) : 0;
  const allDone = useSimpleBar && totalTarget > 0 && done >= totalTarget;

  useEffect(() => {
    if (allDone && !congratsShown.current) {
      congratsShown.current = true;
      toast.success('Норма разборов на эту неделю выполнена', { duration: 6000 });
    }
  }, [allDone]);

  // ─── Простая шкала (пороги не настроены) ──────────────────────────────────
  if (useSimpleBar) {
    return (
      <div className="space-y-2">
        {isRampUp && showRampUpNote && <RampUpChip />}
        <div className="flex items-center gap-4 text-body">
          {callsOn && (
            <span className="flex items-center gap-1.5">
              <span>📞</span>
              <span className="font-medium text-fg">{callCount}/{callTarget}</span>
              <span className="text-fg-subtle">разборов</span>
            </span>
          )}
          {chatsOn && (
            <span className="flex items-center gap-1.5">
              <span>💬</span>
              <span className="font-medium text-fg">{chatCount}/{chatTarget}</span>
              <span className="text-fg-subtle">разборов</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-border rounded-full h-2">
            <div
              className={`rounded-full h-2 transition-all duration-500 ${allDone ? 'bg-success-fg animate-pulse' : 'bg-accent'}`}
              style={{ width: `${Math.min(percent, 100)}%` }}
            />
          </div>
          <span className="text-micro text-fg-subtle w-8 text-right">{percent}%</span>
        </div>
      </div>
    );
  }

  // ─── Шкала с порогами ─────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {isRampUp && showRampUpNote && <RampUpChip />}
      <ThresholdBar
        count={callCount}
        thresholdGood={thresholdGoodCalls}
        thresholdGreat={thresholdGreatCalls}
        label="Звонки (разборов)"
        icon="📞"
        enabled={callsOn}
      />
      <ThresholdBar
        count={chatCount}
        thresholdGood={thresholdGoodChats}
        thresholdGreat={thresholdGreatChats}
        label="Переписки (разборов)"
        icon="💬"
        enabled={chatsOn}
      />
    </div>
  );
}
