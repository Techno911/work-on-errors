import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { adminApi, type WatchdogState } from '@/api/admin';
import { cn, pluralRu } from '@/lib/utils';
import { Button, Card } from '@chirkov/shell';

/**
 * Состояние сторожей платформы. Заменяет ежедневный свод «всё чисто» в Telegram
 * (решение владельца продукта: «сообщений без ценности присылать не надо»).
 *
 * Живость механизма это экран, куда смотрят когда хотят, а мессенджер остаётся для новостей.
 * Поэтому блок по умолчанию свёрнут и раскрывается сам, только когда есть что показать:
 * сторож замолчал или висят незакрытые проблемы.
 */
export function WatchdogsSection() {
  const [state, setState] = useState<WatchdogState[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    adminApi
      .getWatchdogs()
      .then(({ data }) => {
        const list = data?.watchdogs ?? [];
        setState(list);
        if (list.some((w) => w.overdue)) setOpen(true);
      })
      .catch(() => setState([]));
  }, []);

  if (!state || state.length === 0) return null;

  const broken = state.filter((w) => w.overdue);
  const openSignals = state.reduce((n, w) => n + w.openSignals.length, 0);
  const headline = broken.length
    ? `${broken.length} ${pluralRu(broken.length, 'сторож не отчитался', 'сторожа не отчитались', 'сторожей не отчитались')}`
    : openSignals > 0
      ? `все на связи · ${openSignals} ${pluralRu(openSignals, 'открытая проблема', 'открытые проблемы', 'открытых проблем')}`
      : 'все на связи, открытых проблем нет';

  return (
    <Card padding="md" tone={broken.length ? 'danger' : undefined}>
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        variant="ghost"
        size="md"
        fullWidth
        icon={broken.length ? <AlertTriangle /> : <Activity />}
      >
        <span className="flex items-center gap-2 w-full text-fg font-semibold">
          <h2 className="text-body-lg font-semibold text-fg">Сторожа</h2>
          <span className={cn('text-body font-normal', broken.length ? 'text-danger-fg font-medium' : 'text-fg-subtle')}>· {headline}</span>
          <span className="ml-auto text-fg-subtle">
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
        </span>
      </Button>

      {open && (
        <div className="mt-4 space-y-3">
          {state.map((w) => (
            <div key={w.key} className="border-t border-border pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-body font-medium text-fg">{w.label}</span>
                <span className={cn('text-micro', w.overdue ? 'text-danger-fg font-medium' : 'text-fg-subtle')}>
                  {w.lastRunAt
                    ? `последний прогон ${new Date(w.lastRunAt).toLocaleString('ru-RU')}` +
                      (w.silentHours !== null ? ` · ${w.silentHours} ч назад` : '')
                    : 'не запускался ни разу'}
                </span>
              </div>
              {w.openSignals.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {w.openSignals.map((s, i) => (
                    <li key={i} className="text-body text-fg-muted flex gap-2">
                      <span className="text-border">·</span>
                      <span>
                        {/* Текст собран для Telegram, теги там намеренные — на экране показываем без них. */}
                        {s.text.replace(/<[^>]+>/g, '')}
                        <span className="text-fg-subtle text-micro">
                          {' '}· с {new Date(s.firstSeenAt).toLocaleDateString('ru-RU')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <p className="text-micro text-fg-subtle pt-1">
            В Telegram уходит только новость: новая проблема, ухудшение, снятие. Повтор вчерашней картины не отправляется.
          </p>
        </div>
      )}
    </Card>
  );
}
