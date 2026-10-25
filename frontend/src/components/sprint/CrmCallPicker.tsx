import { useEffect, useState, useCallback } from 'react';
import { PhoneIncoming, PhoneOutgoing, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { crmApi } from '@/api/crm';
import { crmErrorText } from '@/content/crmErrors';
import type { CrmCallListItem, StagedRecording } from '@/types';
import { Button, Badge, Card, Chip, Modal, EmptyState } from '@chirkov/shell';

type Period = 'today' | 'week' | 'month';

function fmtDur(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
    d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const STATE_BADGES: Record<string, { text: string; color: 'neutral' | 'warning' }> = {
  processing: { text: 'запись обрабатывается', color: 'warning' },
  external_pbx: { text: 'запись в АТС', color: 'neutral' },
  none: { text: 'без записи', color: 'neutral' },
};

/** Модал выбора звонка из CRM: менеджер видит только свои звонки. */
export function CrmCallPicker({ onPicked, onClose }: {
  onPicked: (staged: StagedRecording) => void;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState<Period>('today');
  const [calls, setCalls] = useState<CrmCallListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Какой строке «запись в АТС» раскрыта подсказка по тапу (работает там, где нет hover)
  const [openPbxId, setOpenPbxId] = useState<string | null>(null);

  const range = useCallback((p: Period) => {
    const to = new Date();
    const from = new Date();
    // Бэкенд допускает период до 31 дня — «Месяц» берём за 30 дней, оставаясь под лимитом
    if (p === 'week') from.setDate(from.getDate() - 7);
    else if (p === 'month') from.setDate(from.getDate() - 30);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { from: f(from), to: f(to) };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setElapsed(0);
    setError('');
    setOpenPbxId(null);
    // Первый листинг amoCRM идёт 20–30 сек — показываем счётчик, чтобы менеджер видел работу
    const started = Date.now();
    const ticker = setInterval(() => {
      if (!cancelled) setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    crmApi.myCalls(range(period))
      .then(({ data }) => { if (!cancelled) setCalls(data ?? []); })
      .catch(err => { if (!cancelled) setError(crmErrorText(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearInterval(ticker); };
  }, [period, range]);

  const pick = async (call: CrmCallListItem) => {
    if (call.alreadyImported || call.recordingState !== 'ready' || fetchingId) return;
    setFetchingId(call.id);
    setError('');
    try {
      const { data } = await crmApi.fetchCall(call.id, range(period));
      onPicked(data);
    } catch (err) {
      setError(crmErrorText(err));
    } finally {
      setFetchingId(null);
    }
  };

  return (
    <Modal
      size="md"
      open
      onClose={onClose}
      title="Ваши звонки из CRM"
    >
      <div className="flex gap-1 mb-3">
        {([['today', 'Сегодня'], ['week', 'Неделя'], ['month', 'Месяц']] as const).map(([p, label]) => (
          <Button
            key={p}
            type="button"
            variant={period === p ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setPeriod(p)}
          >
            {label}
          </Button>
        ))}
      </div>

      <div className="space-y-1.5">
        {loading && (
          <div className="flex flex-col items-center justify-center py-10 text-fg-subtle text-body gap-2">
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Загружаем звонки…
            </span>
            {elapsed >= 4 && (
              <span className="text-micro text-fg-subtle">
                Первая загрузка занимает до 30 секунд · {elapsed} с
              </span>
            )}
          </div>
        )}
        {!loading && !error && calls.length === 0 && (
          <EmptyState
            icon={PhoneOutgoing}
            title="За этот период звонков в CRM не найдено."
            description={
              period === 'today'
                ? 'Возможно, звонки были раньше сегодняшнего дня. Расширьте период.'
                : period === 'week'
                  ? 'За неделю пусто: возможно, звонки были раньше. Посмотрите за месяц.'
                  : 'За месяц звонков нет. Если звонки точно были, проверьте, что вы сопоставлены с нужной учёткой CRM. Это настраивает владелец в разделе «Настройки → Интеграции».'
            }
            action={
              period === 'today' ? (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" type="button" onClick={() => setPeriod('week')}>
                    Показать за неделю
                  </Button>
                  <Button variant="ghost" size="sm" type="button" onClick={() => setPeriod('month')}>
                    За месяц
                  </Button>
                </div>
              ) : period === 'week' ? (
                <Button variant="ghost" size="sm" type="button" onClick={() => setPeriod('month')}>
                  Показать за месяц
                </Button>
              ) : undefined
            }
          />
        )}
        {!loading && calls.map(call => {
          const badge = STATE_BADGES[call.recordingState];
          const clickable = call.recordingState === 'ready' && !call.alreadyImported;
          const isPbx = call.recordingState === 'external_pbx';
          const rowInner = (
            <>
              {call.direction === 'in'
                ? <PhoneIncoming className="w-4 h-4 text-success-fg flex-shrink-0" />
                : <PhoneOutgoing className="w-4 h-4 text-info flex-shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-body font-medium text-fg break-words">{call.phone || 'Номер скрыт'}</p>
                <p className="text-micro text-fg-subtle">{fmtDate(call.startedAt)} · {fmtDur(call.durationSec)}</p>
              </div>
              {fetchingId === call.id ? (
                <span className="flex items-center gap-1.5 text-micro text-accent-hover flex-shrink-0">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Скачиваем…
                </span>
              ) : call.alreadyImported ? (
                <Badge tone="success">уже добавлен</Badge>
              ) : isPbx ? (
                // Причина «запись в АТС» раскрывается по тапу — на телефоне hover-подсказки нет
                <Chip
                  pressed={openPbxId === call.id}
                  onPressedChange={(open) => setOpenPbxId(open ? call.id : null)}
                  tone={badge.color}
                >
                  {badge.text}
                </Chip>
              ) : badge ? (
                <Badge tone={badge.color}>{badge.text}</Badge>
              ) : null}
            </>
          );
          const rowCls = cn(
            'w-full flex items-center gap-3 p-3 rounded-block border text-left transition-colors',
            clickable
              ? 'border-border hover:border-accent-border hover:bg-accent-subtle'
              : 'border-border bg-canvas opacity-70',
          );
          return (
            <div key={call.id}>
              {clickable ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  fullWidth
                  disabled={fetchingId !== null}
                  onClick={() => pick(call)}
                  data-ui-role="choice-row"
                >
                  <span className="flex items-center gap-3 w-full text-left font-normal">{rowInner}</span>
                </Button>
              ) : (
                <div className={rowCls} data-ui-role="disabled-choice-row">{rowInner}</div>
              )}
              {isPbx && openPbxId === call.id && (
                <Card padding="none" surface="canvas" className="mt-1 text-micro text-fg-muted">
                  <div className="px-3 py-2">
                    Запись хранится в вашей АТС, CRM её не получила. Скачайте файл из личного кабинета телефонии и загрузите через «Аудиофайл».
                  </div>
                </Card>
              )}
            </div>
          );
        })}
        {error && <p className="text-micro text-danger-fg bg-danger-subtle rounded-card px-3 py-2" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
