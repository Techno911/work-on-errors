import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, LifeBuoy, Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { dashboardApi, type OwnerStateData } from '@/api/dashboard';
import { Button, Badge, Card } from '@chirkov/shell';

const PERSON_STATE_BADGE = {
  ok: { color: 'success' },
  no_work: { color: 'warning' },
  never_logged: { color: 'danger' },
} as const;

/**
 * Экран состояния для собственника.
 *
 * Раньше собственнику отдавался экран РОПа, и при отсутствии данных за неделю он видел
 * «Нет данных за текущий спринт»: ровно в тот момент, когда новость самая важная, экран
 * говорил, что новостей нет. Здесь три вопроса в том порядке, в каком их задаёт человек,
 * заходящий раз в месяц: идёт работа или нет, кто именно её не делает, что от меня требуется.
 *
 * Поля и межстрочные зазоры на узких экранах ужаты (на sm и шире всё прежнее):
 * от смены гарнитуры на Inter имя с ролью перестали помещаться в строку, и
 * решение владельца было такое — перенос оставить, а рост карточки погасить
 * конструкцией, не возвращая обрезку.
 *
 * Когда всё в норме, блок свёрнут в одну строку. Когда нет — раскрыт, стоит первым и содержит
 * имена, а не проценты: «Игорь не входил с 30 июля» рождает действие, «вовлечённость 34%» нет.
 */
export function OwnerStateCard({ companyId }: { companyId: string }) {
  const [data, setData] = useState<OwnerStateData | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!companyId) return;
    dashboardApi
      .getOwnerState(companyId)
      .then(({ data }) => {
        setData(data);
        // Раскрыт по умолчанию, когда есть о чём сказать. В норме одна строка.
        setExpanded(data.work.state !== 'running' && data.work.state !== 'ramping');
      })
      .catch(() => setData(null));
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  if (!data) return null;

  const bad = data.work.state === 'silent' || data.work.state === 'not_started';
  const warn = data.work.state === 'lagging';

  const runAction = async (key: string) => {
    setBusy(key);
    try {
      if (key === 'resend_access') {
        const { data: res } = await dashboardApi.resendAccess(companyId);
        if (res.failed.length) {
          toast.error(`Отправлено ${res.sent}. Не ушло: ${res.failed.join('; ')}`, { duration: Infinity });
        } else {
          toast.success(`Доступы отправлены в рабочий чат: ${res.sent} чел.`);
        }
      } else if (key === 'call_tracker') {
        await dashboardApi.callTracker(companyId);
        toast.success('Мы получили сигнал и свяжемся с вами');
      }
      load();
    } catch (err) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e?.response?.data?.message ?? 'Не получилось. Напишите нам, разберёмся', { duration: Infinity });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card padding="none" tone={bad ? 'danger' : warn ? 'warning' : undefined} className="mb-6">
      {/* Вопрос первый: идёт работа или нет */}
      <Button
        type="button"
        variant="ghost"
        size="md"
        fullWidth
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label="Состояние работы команды"
        icon={bad ? <AlertTriangle className="text-danger" /> : warn ? <AlertTriangle className="text-warning" /> : <CheckCircle2 className="text-success" />}
      >
        <span className="flex items-center justify-between gap-3 w-full text-left font-normal">
          <span className="min-w-0">
            <p className={cn('text-body font-semibold', bad ? 'text-danger-fg' : warn ? 'text-warning-fg' : 'text-fg')}>
              {data.paused
                ? `Работа на паузе${data.paused.expectedReturnAt ? ` до ${new Date(data.paused.expectedReturnAt).toLocaleDateString('ru-RU')}` : ''}`
                : data.work.label}
            </p>
            {/* Обрезать эту строку нельзя: в ней стоит ДАТА последней сданной
                записи, и «28.07.2…» перестаёт быть фактом. На узком экране она
                переносится на вторую строку. До смены гарнитуры строка влезала
                и обрезка не срабатывала, поэтому дефект был не виден. */}
            <p className={cn('text-body mt-0.5', bad ? 'text-danger-fg' : warn ? 'text-warning-fg' : 'text-fg-subtle')}>
              {data.paused?.reason ?? data.work.detail}
            </p>
          </span>
          {expanded
            ? <ChevronUp className="w-4 h-4 text-fg-disabled flex-shrink-0" aria-hidden="true" />
            : <ChevronDown className="w-4 h-4 text-fg-disabled flex-shrink-0" aria-hidden="true" />}
        </span>
      </Button>

      {expanded && (
        <div className="px-4 pb-4 space-y-2 sm:px-5 sm:pb-5 sm:space-y-4">
          {/* Вопрос второй: кто именно не делает работу. Поимённо, с датами. */}
          {data.people.length > 0 && (
            <Card radius="block" padding="none" className="divide-y divide-border">
              {data.people.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-1.5 sm:py-2.5">
                  <div className="min-w-0">
                    {/* Имя и роль переносятся, а не обрезаются: это главный экран
                        владельца на телефоне, и «Бегларян Артур Ваграмови…» вместо
                        имени сотрудника здесь дороже лишней строки. Заодно уходит
                        обрезка роли («рук…», «мене…»), позиция И-37 реестра. */}
                    <p className="text-body font-medium text-fg">
                      {p.fullName} <span className="text-fg-subtle font-normal">· {p.roleLabel}</span>
                    </p>
                    <p className="text-micro text-fg-subtle sm:mt-0.5">{p.note}</p>
                  </div>
                  <Badge tone={PERSON_STATE_BADGE[p.state].color}>
                    {p.state === 'ok' ? 'работает' : p.state === 'no_work' ? 'не сдаёт' : 'не заходил'}
                  </Badge>
                </div>
              ))}
            </Card>
          )}

          {/* Вопрос третий: что от меня требуется. Максимум три пункта, дальше человек не читает. */}
          {data.actions.length > 0 && (
            <div className="space-y-2">
              {data.actions.map(a => (
                <Card key={a.key} padding="none" radius="block">
                  <div className="px-3 py-3">
                    <p className="text-body font-medium text-fg">{a.label}</p>
                    <p className="text-micro text-fg-subtle mt-0.5">{a.hint}</p>
                    {a.key === 'resend_access' && (
                      <div className="mt-2">
                        <Button
                          type="button"
                          variant="primary"
                          size="sm"
                          onClick={() => runAction('resend_access')}
                          disabled={busy !== null || !data.hasWorkChat}
                          title={data.hasWorkChat ? undefined : 'Рабочий чат не подключён: напишите нам, поможем'}
                          icon={<Send />}
                        >
                          {busy === 'resend_access' ? 'Отправляем…' : 'Отправить в рабочий чат'}
                        </Button>
                      </div>
                    )}
                    {a.key === 'call_tracker' && (
                      <div className="mt-2">
                        <Button variant="secondary" size="sm"
                          type="button"
                          onClick={() => runAction('call_tracker')}
                          disabled={busy !== null}
                          icon={<LifeBuoy />}
                        >
                          {busy === 'call_tracker' ? 'Зовём…' : 'Позвать трекера'}
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {data.actions.length === 0 && data.people.every(p => p.state === 'ok') && (
            <p className="text-body text-fg-subtle">
              От вас сейчас ничего не требуется: команда работает, разборы идут.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
