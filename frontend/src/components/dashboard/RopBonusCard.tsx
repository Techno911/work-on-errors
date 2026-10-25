import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Lock, Wallet } from 'lucide-react';
import { ropBonusApi } from '@/api/rop-bonus';
import { useAuthStore } from '@/stores/authStore';
import type { RopBonusStats } from '@/types';
import { Badge, Button, ButtonLink, Card, Table } from '@chirkov/shell';

const MONTH_LABELS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
}

function rub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

function frozenDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

type BonusStatus = {
  label: string;
  color: 'success' | 'accent' | 'danger';
};

/**
 * Карточка «Премия за работу над ошибками» на дашборде.
 * РОП видит обращение во втором лице, владелец — премию своего РОПа в третьем.
 * Рендерится только при включённой премии (гейт в DashboardPage).
 */
export function RopBonusCard({ companyId, stats }: { companyId: string; stats: RopBonusStats }) {
  const user = useAuthStore(s => s.user);
  const isOwnerView = user?.role === 'owner' || user?.role === 'superadmin';
  const [view, setView] = useState<'current' | 'history'>('current');
  const [history, setHistory] = useState<RopBonusStats[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    if (view !== 'history' || history !== null || !companyId) return;
    setHistoryLoading(true);
    ropBonusApi.getHistory(companyId, 6)
      .then(r => setHistory(r.data ?? []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [view, history, companyId]);

  const pct = stats.onTimePct;
  // Линейная модель (по договору): премия = база × %, отсечка minPct. Ступени — легаси.
  const isLinear = stats.mode === 'linear';
  const minPct = stats.minThresholdPct ?? 60;
  const baseAmount = stats.baseAmount ?? 0;
  // Премия включена, но уровни не настроены — расчёт невозможен, не пугаем «0 ₽ / Под угрозой».
  // Для линейного режима tiers пустой намеренно — это не «не настроено».
  const tiersEmpty = !isLinear && stats.tiers.length === 0;
  const topTier = stats.tiers[0] ?? null;
  const reachedTop = isLinear
    ? (pct !== null && pct >= 95)
    : (topTier !== null && pct !== null && pct >= topTier.thresholdPct);
  const aboveThreshold = isLinear ? (pct !== null && pct >= minPct) : (stats.currentTier !== null);
  const barColor = pct === null
    ? 'var(--color-border)'
    : reachedTop ? 'var(--color-success)' : aboveThreshold ? 'var(--color-accent)' : 'var(--color-danger)';

  // Статус премии: честное состояние вместо «всё уже заработано»
  const status: BonusStatus | null = pct === null && stats.pendingCount === 0
    ? null
    : reachedTop && stats.pendingCount === 0
      ? { label: 'Заработана', color: 'success' }
      : (stats.currentAmount > 0 || stats.bestCaseAmount > 0)
        ? { label: 'Идёт по плану', color: 'accent' }
        : { label: 'Под угрозой', color: 'danger' };
  const atRisk = status?.label === 'Под угрозой';

  const title = isOwnerView && stats.ropName
    ? `Премия РОПа: ${stats.ropName}`
    : 'Премия за работу над ошибками';

  // Главная подсказка-действие (для владельца — в третьем лице)
  let hint: string | null = null;
  if (pct === null && stats.pendingCount === 0) {
    hint = 'Пока нет данных за этот месяц. Как только менеджеры начнут сдавать записи, расчёт запустится автоматически.';
  } else if (stats.pendingCount > 0 && stats.bestCaseAmount > stats.currentAmount) {
    hint = isOwnerView
      ? `В очереди у РОПа ${stats.pendingCount} записей. Если ревью выйдут в срок, процент вырастет до ${stats.bestCasePct}% и премия составит ${rub(stats.bestCaseAmount)}.`
      : `Ожидают ревью: ${stats.pendingCount}. Успейте в срок: процент вырастет до ${stats.bestCasePct}% и премия составит ${rub(stats.bestCaseAmount)}.`;
  } else if (stats.pendingCount > 0) {
    // Запас прочности: сколько из ожидающих можно сдать с опозданием, не слетев с текущего уровня
    const total = stats.onTimeCount + stats.lateCount + stats.pendingCount;
    const threshold = stats.currentTier?.thresholdPct ?? 0;
    const slack = threshold > 0
      ? Math.max(0, Math.floor(stats.onTimeCount + stats.pendingCount - (threshold / 100) * total))
      : stats.pendingCount;
    const keepText = slack === 0
      ? `все ${stats.pendingCount} нужно сдать в срок, иначе уровень премии снизится`
      : `с опозданием можно сдать не больше ${Math.min(slack, stats.pendingCount)}, иначе уровень премии снизится`;
    hint = isOwnerView
      ? `В очереди у РОПа ${stats.pendingCount} записей. Запас: ${keepText}.`
      : `Ожидают ревью: ${stats.pendingCount}. Ответьте в течение ${stats.maxHoursToRespond} ч, и текущий уровень сохранится. Запас: ${keepText}.`;
  } else if (stats.nextTier) {
    hint = `Следующий уровень: от ${stats.nextTier.thresholdPct}% (${rub(stats.nextTier.amount)}). Новые ревью в срок поднимут процент.`;
  } else if (isLinear && pct !== null) {
    hint = pct < minPct
      ? `Сейчас ${pct}%: ниже отсечки ${minPct}%, поэтому премия за месяц пока не начисляется. ${isOwnerView ? 'РОПу нужно довести' : 'Доведите'} разборы в срок до ${minPct}% и выше.`
      : `Каждый разбор в срок повышает процент и сумму. При 100% премия достигнет ${rub(baseAmount)}.`;
  }

  return (
    <Card padding="md">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Wallet className="w-4 h-4 text-accent flex-shrink-0" />
          {/* Заголовок переносится, а не обрезается: у Inter он перестал
             помещаться на 390 и превращался в «Премия за работу над…».
             Название карточки, обрезанное многоточием, перестаёт называть
             карточку. */}
          <h2 className="text-body-lg font-semibold text-fg">{title}</h2>
          <div className="relative flex-shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowInfo(v => !v)}
              aria-label="Как считается премия"
              icon={<Info className={showInfo ? 'text-accent' : 'text-border'} />}
            />
            {showInfo && (
              <div className="absolute left-1/2 -translate-x-1/2 top-6 z-20 w-72 bg-inverse-hover text-on-inverse text-micro rounded-card p-3 shadow-overlay">
                Считается автоматически: процент ревью команды, написанных в пределах {stats.maxHoursToRespond} ч
                после отправки записи, за календарный месяц. Запись без ревью после срока считается «не в срок».
                Записи, у которых срок ещё не вышел, в расчёт пока не входят.
                {stats.minReviewChars ? ` Короткие отписки (меньше ${stats.minReviewChars} символов) в расчёт премии не входят.` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1 bg-surface-sunken p-0.5 rounded-block">
          <Button
            type="button"
            variant={view === 'current' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('current')}
          >
            Текущий месяц
          </Button>
          <Button
            type="button"
            variant={view === 'history' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setView('history')}
          >
            История
          </Button>
        </div>
      </div>

      {view === 'current' && tiersEmpty && (
        <Card padding="none" surface="canvas" radius="block" className="text-body text-fg-muted">
          <div className="px-4 py-3">
            {isOwnerView
              ? 'Премия включена, но уровни не настроены. Задайте пороги и суммы в настройках компании. Тогда запустится расчёт.'
              : 'Премия включена, но уровни пока не настроены. Попросите владельца задать пороги и суммы. Тогда появится расчёт.'}
            {isOwnerView && (
              <Link to="/settings" className="font-medium text-accent-hover hover:text-accent-fg ml-1">
                Открыть настройки →
              </Link>
            )}
          </div>
        </Card>
      )}

      {view === 'current' && !tiersEmpty && (
        <>
          <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-page font-bold text-fg">{rub(stats.currentAmount)}</p>
                {status && (
                  <Badge tone={status.color}>{status.label}</Badge>
                )}
              </div>
              <p className="text-body text-fg-subtle mt-0.5">
                {stats.daysLeftInMonth > 0 ? 'промежуточный расчёт за ' : 'премия за '}{periodLabel(stats.period)}
                {' · по скорости ответа (до ' + stats.maxHoursToRespond + ' ч)'}
                {stats.payoutDay ? ` · выплата ${stats.payoutDay}-го числа` : ''}
              </p>
            </div>
            <div className="text-right">
              <p className="text-section font-semibold" style={{ color: barColor === 'var(--color-border)' ? 'var(--color-fg-subtle)' : barColor }}>
                {pct === null ? '–' : `${pct}%`}
              </p>
              <p className="text-micro text-fg-subtle">ревью в срок</p>
            </div>
          </div>

          {/* Прогресс-бар с засечками уровней */}
          <div className="relative mb-1">
            <div
              role="progressbar"
              aria-valuenow={pct ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Доля ревью в срок"
              className="h-3 bg-surface-sunken rounded-full overflow-hidden"
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct ?? 0}%`, backgroundColor: barColor }}
              />
            </div>
            {(isLinear ? [minPct] : stats.tiers.map(t => t.thresholdPct)).map(mark => (
              <div
                key={mark}
                className="absolute top-0 h-3 w-0.5 bg-surface"
                style={{ left: `${mark}%` }}
              />
            ))}
          </div>
          {isLinear ? (
            <p className="text-micro text-fg-subtle mb-3">
              «В срок» означает ревью в течение {stats.maxHoursToRespond} ч после отправки записи.{' '}
              Премия: база {rub(baseAmount)} × процент разборов в срок. Ниже {minPct}%: без премии.
            </p>
          ) : (
            <p className="text-micro text-fg-subtle mb-3">
              «В срок» означает ревью в течение {stats.maxHoursToRespond} ч после отправки записи.{' '}
              {[...stats.tiers].reverse().map(t => `От ${t.thresholdPct}%: ${rub(t.amount)}`).join(' · ')}
              {stats.tiers.length > 0 && ` · ниже ${Math.min(...stats.tiers.map(t => t.thresholdPct))}%: без премии`}.
            </p>
          )}

          <div className="flex items-center justify-between text-body text-fg-muted mb-1 gap-x-3 flex-wrap">
            <ButtonLink as={Link} to="/sprint" variant="ghost" align="start">
              В зачёте: <b>{stats.onTimeCount}</b> из <b>{stats.onTimeCount + stats.lateCount + (stats.shortCount ?? 0)}</b>
              {(() => {
                const short = stats.shortCount ?? 0;
                const notCounted = stats.lateCount + short;
                if (notCounted === 0) return null;
                const parts: string[] = [];
                if (stats.lateCount > 0) parts.push(`опоздали ${stats.lateCount}`);
                if (short > 0) parts.push(`короткие ${short}`);
                return (
                  <span className="text-danger"> · не в зачёте {notCounted} ({parts.join(', ')})</span>
                );
              })()}
              {' '}→
            </ButtonLink>
            {stats.daysLeftInMonth > 0 && (
              <span className="text-fg-subtle text-micro">до конца месяца {stats.daysLeftInMonth} дн.</span>
            )}
          </div>

          {hint && (
            stats.pendingCount > 0 ? (
              <Card as={Link} to="/sprint" interactive padding="none" surface="canvas" radius="block" tone={atRisk ? 'danger' : undefined}>
                <div className={`px-4 py-3 text-body ${atRisk ? 'text-danger-fg' : 'text-fg-muted'}`}>
                  {hint} <span className="font-medium">Открыть записи →</span>
                </div>
              </Card>
            ) : (
              <Card padding="none" surface="canvas" radius="block" tone={atRisk ? 'danger' : undefined}>
                <div className={`px-4 py-3 text-body ${atRisk ? 'text-danger-fg' : 'text-fg-muted'}`}>{hint}</div>
              </Card>
            )
          )}
        </>
      )}

      {view === 'history' && (
        <div>
          {historyLoading && <p className="text-body text-fg-subtle py-4 text-center">Загрузка…</p>}
          {!historyLoading && history && (
            <Table
              caption="История премии РОПа по месяцам"
              rows={history}
              rowKey={(h) => h.period}
              mobile="scroll"
              empty="Закрытых месяцев пока нет"
              columns={[
                {
                  key: 'period',
                  header: 'Месяц',
                  render: (h) => (
                    <span className="text-fg-muted">
                      <span className="capitalize">{periodLabel(h.period)}</span>
                      {h.daysLeftInMonth > 0 ? (
                        <span className="text-micro text-fg-subtle"> · идёт</span>
                      ) : h.frozen ? (
                        <span
                          className="inline-flex items-center gap-1 text-micro text-success-fg align-middle ml-1"
                          title={h.frozenAt ? `Зафиксировано ${frozenDate(h.frozenAt)}` : 'Зафиксировано'}
                        >
                          <Lock className="w-2.5 h-2.5" />
                          {h.frozenAt ? `зафиксировано ${frozenDate(h.frozenAt)}` : 'зафиксировано'}
                        </span>
                      ) : (
                        <span className="text-micro text-fg-subtle"> · расчётно</span>
                      )}
                    </span>
                  ),
                },
                {
                  key: 'onTime',
                  header: 'Ревью в срок',
                  align: 'center',
                  render: (h) => (h.onTimeCount + h.lateCount > 0 ? `${h.onTimeCount} из ${h.onTimeCount + h.lateCount}` : '–'),
                },
                { key: 'pct', header: '%', align: 'center', render: (h) => (h.onTimePct === null ? '–' : `${h.onTimePct}%`) },
                { key: 'amount', header: 'Премия', numeric: true, render: (h) => (h.onTimePct === null ? '–' : rub(h.currentAmount)) },
              ]}
            />
          )}
          {/* Личный рекорд — соревнование с самим собой, единственное честное для одиночной роли */}
          {!historyLoading && history && (() => {
            const closed = history.filter(h => h.daysLeftInMonth === 0 && h.onTimePct !== null);
            if (closed.length < 2) return null;
            const best = closed.reduce((a, b) => ((b.onTimePct ?? 0) > (a.onTimePct ?? 0) ? b : a));
            return (
              <p className="text-micro font-medium mt-3 px-3 py-2 rounded-card" style={{ backgroundColor: 'var(--color-success-subtle)', color: 'var(--color-success-fg)', border: '1px solid var(--color-success-border)' }}>
                Личный рекорд: {best.onTimePct}% ревью в срок ({periodLabel(best.period)})
              </p>
            );
          })()}
          {!historyLoading && history && history.some(h => h.frozen) && (
            <p className="text-micro text-fg-subtle mt-2">
              Зафиксированные месяцы записаны снимком в день расчёта и не меняются при смене норматива или уровней.
              Месяцы с пометкой «расчётно» считаются по текущему нормативу и могут измениться.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
