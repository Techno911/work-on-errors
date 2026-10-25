import { useEffect } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import type { RopBonusData, RopBonusTier } from '@/types';
import { Button, Switch, Input, Card } from '@chirkov/shell';

/**
 * Проверка уровней на дубли порогов и инверсию сумм.
 * Дубль порога: один и тот же % встречается дважды (расчёт берёт только один).
 * Инверсия: более высокий порог даёт сумму меньше, чем более низкий — РОП теряет
 * деньги за лучший результат. Возвращает индексы проблемных строк (в порядке tiers).
 */
function findTierIssues(tiers: RopBonusTier[]): { dup: Set<number>; inverted: Set<number> } {
  const dup = new Set<number>();
  const inverted = new Set<number>();
  tiers.forEach((t, i) => {
    tiers.forEach((o, j) => {
      if (i < j && t.thresholdPct === o.thresholdPct) { dup.add(i); dup.add(j); }
    });
  });
  // tiers отсортированы по убыванию порога; идём сверху вниз — сумма не должна расти
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].amount > tiers[i - 1].amount) { inverted.add(i); inverted.add(i - 1); }
  }
  return { dup, inverted };
}

const DEFAULT_ROP_BONUS: RopBonusData = {
  enabled: false,
  tiers: [
    { thresholdPct: 95, amount: 20000 },
    { thresholdPct: 80, amount: 16000 },
  ],
};

/**
 * Секция «Премия РОПа» в настройках (таб «Нормативы»).
 * Управляет company.ropBonus через draft родителя — сохранение общей кнопкой таба.
 *
 * 16.09.2026: премия считается по компании, а владелец думает про ЧЕЛОВЕКА («можно выключить
 * премию Анастасии?»). Поэтому рядом с тумблером названо, кого премия касается сейчас, а
 * выключение показывает последствия и записывается как осознанное решение (declinedExplicitly):
 * иначе выключенная владельцем премия выглядела для нас как «решение о дисциплине не принято».
 */
export function RopBonusSettings({ value, maxHoursToRespond, onChange, onValidityChange, ropNames = [], savedEnabled }: {
  value: RopBonusData | undefined | null;
  maxHoursToRespond: number;
  onChange: (v: RopBonusData) => void;
  /** Сообщает родителю, можно ли сохранять (false при дублях порогов / инверсии сумм). */
  onValidityChange?: (valid: boolean) => void;
  /** Имена действующих РОПов компании: премия считается для того, кто в этой роли. */
  ropNames?: string[];
  /** Сохранённое состояние премии — чтобы отличить «выключаю сейчас» от «выключена давно». */
  savedEnabled?: boolean;
}) {
  // Премия живёт на компании, а решение владелец принимает про человека — поэтому имя названо.
  const singleRop = ropNames.length === 1 ? ropNames[0] : null;
  const data = value ?? DEFAULT_ROP_BONUS;
  // Линейный режим (по договору): база × %, отсечка. Если baseAmount задан — приоритет над ступенями.
  const isLinear = data.baseAmount != null;
  const tiers = [...(data.tiers ?? [])].sort((a, b) => b.thresholdPct - a.thresholdPct);
  const { dup, inverted } = findTierIssues(tiers);
  const hasDup = dup.size > 0;
  const hasInverted = inverted.size > 0;

  // Поднимаем родителю флаг валидности — чтобы общая кнопка сохранения блокировалась
  useEffect(() => {
    onValidityChange?.(!hasDup && !hasInverted);
  }, [hasDup, hasInverted, onValidityChange]);

  const updateTier = (index: number, patch: Partial<RopBonusTier>) => {
    const next = tiers.map((t, i) => (i === index ? { ...t, ...patch } : t));
    onChange({ ...data, tiers: next });
  };

  const removeTier = (index: number) => {
    onChange({ ...data, tiers: tiers.filter((_, i) => i !== index) });
  };

  const addTier = () => {
    const minThreshold = tiers.length > 0 ? Math.min(...tiers.map(t => t.thresholdPct)) : 100;
    const newThreshold = Math.max(1, minThreshold - 15);
    onChange({ ...data, tiers: [...tiers, { thresholdPct: newThreshold, amount: 0 }] });
  };

  return (
    <Card padding="md">
      <h2 className="text-body-lg font-semibold text-fg mb-1">Премия РОПа за работу над ошибками</h2>
      <p className="text-micro text-fg-subtle mb-4">
        Платформа сама считает процент ревью «в срок» за календарный месяц и показывает РОПу прогресс к премии.
        «В срок» = ревью написано в пределах {maxHoursToRespond} ч после отправки записи (норматив «Максимум часов до ответа» выше).
      </p>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 border-b border-border">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-body font-medium text-fg">Премия включена</div>
          <div className="text-micro text-fg-subtle mt-0.5">
            РОП видит на главной карточку с прогрессом и суммой премии.{' '}
            {ropNames.length === 0
              ? <>В компании сейчас нет РОПа, поэтому считать премию некому.</>
              : singleRop
                ? <>Сейчас премия считается для: <span className="text-fg-muted font-medium">{singleRop}</span>. Сменится РОП, премия перейдёт к нему.</>
                : <>Сейчас премия считается для всех, кто в роли РОПа: <span className="text-fg-muted font-medium">{ropNames.join(', ')}</span>.</>}
          </div>
        </div>
        <Switch
          value={data.enabled}
          labels={['Включено', 'Выключено']}
          aria-label="Премия включена"
          onChange={(next) => {
            // Выключение владельцем — это и есть его решение «премии не будет»: помечаем явно,
            // иначе шаг дисциплины остаётся для нас незакрытым и компания числится непокрытой.
            onChange({ ...data, enabled: next, declinedExplicitly: !next });
          }}
        />
      </div>

      {savedEnabled && !data.enabled && (
        <div className="mt-3 flex items-start gap-2 rounded-card border border-warning-border bg-warning-subtle px-3 py-2.5 text-micro text-warning-fg">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Что произойдёт после сохранения</p>
            <p>
              {singleRop ? `${singleRop} перестанет` : 'РОП перестанет'} видеть карточку премии на главной, расчёт выплаты
              за текущий месяц не придёт в каналы отчётности. Уже посчитанные месяцы останутся в истории премии.
              Включить обратно можно этим же тумблером.
            </p>
          </div>
        </div>
      )}

      {isLinear ? (
      <div className="pt-4">
        <p className="text-body font-medium text-fg-muted mb-2">Формула премии</p>
        <p className="text-micro text-fg-subtle mb-3">
          Премия = базовая сумма × процент ревью в срок за месяц. Если процент ниже отсечки, премия за месяц 0 ₽.
          Так платформа считает премию, как указано в договоре.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-micro font-medium text-fg-muted mb-1">Базовая сумма, ₽</label>
            <div className="w-32 text-center">
              <Input
                type="number"
                value={data.baseAmount ?? 0}
                min={0}
                step={1000}
                onChange={e => onChange({ ...data, baseAmount: Math.max(0, Number(e.target.value)) })}
              />
            </div>
          </div>
          <div>
            <label className="block text-micro font-medium text-fg-muted mb-1">Отсечка, %</label>
            <div className="w-24 text-center">
              <Input
                type="number"
                value={data.minThresholdPct ?? 60}
                min={1}
                max={100}
                onChange={e => onChange({ ...data, minThresholdPct: Math.max(1, Math.min(100, Number(e.target.value))) })}
              />
            </div>
          </div>
        </div>
        <p className="text-micro text-fg-subtle mt-3">
          Пример: база 20 000 ₽, отсечка 60%. При 80% разборов в срок премия = 16 000 ₽. При 55% премия 0 ₽.
        </p>
      </div>
      ) : (
      <div className="pt-4">
        <p className="text-body font-medium text-fg-muted mb-2">Уровни премии</p>
        <div className="space-y-2">
          {tiers.map((tier, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-body text-fg-muted">
              <span>при ≥</span>
              <div className="w-24 text-center">
                <Input
                  type="number"
                  value={tier.thresholdPct}
                  min={1}
                  max={100}
                  onChange={e => updateTier(i, { thresholdPct: Math.max(1, Math.min(100, Number(e.target.value))) })}
                  invalid={dup.has(i)}
                />
              </div>
              <span>% ревью в срок →</span>
              <div className="w-32 text-center">
                <Input
                  type="number"
                  value={tier.amount}
                  min={0}
                  max={1000000}
                  step={1000}
                  onChange={e => updateTier(i, { amount: Math.max(0, Number(e.target.value)) })}
                  invalid={inverted.has(i)}
                />
              </div>
              <span>₽</span>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => removeTier(i)}
                  aria-label="Удалить уровень"
                  icon={<Trash2 />}
                />
              </div>
            </div>
          ))}
          {tiers.length === 0 && (
            <p className="text-micro text-fg-subtle">Уровней нет, премия всегда 0 ₽. Добавьте хотя бы один уровень.</p>
          )}
        </div>

        {(hasDup || hasInverted) && (
          <div className="mt-3 flex items-start gap-2 rounded-card border border-danger-border bg-danger-subtle px-3 py-2.5 text-micro text-danger-fg">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              {hasDup && (
                <p>Два уровня с одинаковым порогом: в расчёт попадёт только один. Сделайте пороги разными.</p>
              )}
              {hasInverted && (
                <p>Более высокий порог даёт сумму меньше, чем более низкий: РОП теряет премию за лучший результат. Поднимите сумму у верхнего уровня.</p>
              )}
              <p className="font-medium">Исправьте подсвеченные поля перед сохранением.</p>
            </div>
          </div>
        )}
        <div className="mt-3">
          <Button
            variant="ghost"
            size="md"
            type="button"
            onClick={addTier}
            icon={<Plus />}
          >
            Добавить уровень
          </Button>
        </div>
        <p className="text-micro text-fg-subtle mt-2">
          Ниже самого низкого уровня премия 0 ₽. Пример: ≥95% → 20 000 ₽, 80–94% → 16 000 ₽, меньше 80% → 0 ₽.
        </p>
      </div>
      )}

      <div className="pt-4 border-t border-border mt-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
          <div className="min-w-0 flex-1 basis-48">
            <label className="text-body text-fg-muted font-medium">День выплаты премии</label>
            <p className="text-micro text-fg-subtle mt-0.5">
              Утром в этот день расчёт премии за прошлый месяц придёт в каналы отчётности (блок ниже). 0 = не отправлять.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-20 text-center">
              <Input
                type="number"
                value={data.payoutDay ?? 0}
                min={0}
                max={28}
                onChange={e => {
                  const v = Math.max(0, Math.min(28, Number(e.target.value)));
                  onChange({ ...data, payoutDay: v === 0 ? null : v });
                }}
              />
            </div>
            <span className="text-micro text-fg-subtle">число</span>
          </div>
        </div>
        <p className="text-micro text-fg-subtle">
          Прогноз премии за текущий месяц также входит в еженедельный понедельничный отчёт.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 mt-2 border-t border-border">
          <div className="min-w-0 flex-1 basis-48">
            <div className="text-body font-medium text-fg">Норматив в рабочих днях</div>
            <div className="text-micro text-fg-subtle mt-0.5">
              Срок ревью, выпавший на субботу или воскресенье, переносится на понедельник 12:00, чтобы РОП не терял премию из-за выходных
            </div>
          </div>
          <Switch
            value={data.workdaysOnly !== false}
            labels={['Включено', 'Выключено']}
            aria-label="Норматив в рабочих днях"
            onChange={(next) => onChange({ ...data, workdaysOnly: next })}
          />
        </div>
      </div>
    </Card>
  );
}
