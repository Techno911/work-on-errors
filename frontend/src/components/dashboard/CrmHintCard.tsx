import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Link2, ChevronDown } from 'lucide-react';
import { crmApi } from '@/api/crm';
import type { CrmHint } from '@/types';
import { Button, Card } from '@chirkov/shell';

/**
 * Подсказка «подключите CRM» руководителю отдела продаж и владельцу.
 *
 * Зачем: у одного клиента команда носила звонки файлами девятнадцать раз подряд, хотя amoCRM у
 * них есть. Подключение никто не запрещал, о нём просто забыли после онбординга, а платформа
 * молчала: неподключённая CRM выглядела одинаково и когда так решили, и когда упустили.
 *
 * Показывается не всем и не всегда: только если наша команда не отметила «подключать нечем»,
 * работа идёт дольше десяти дней и подсказку не откладывали (см. myCrmHint на сервере).
 */
export function CrmHintCard({ canConnect }: { canConnect: boolean }) {
  const [hint, setHint] = useState<CrmHint | null>(null);
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    crmApi.myHint()
      .then(({ data }) => setHint(data))
      .catch(() => setHint(null)); // подсказка не критична, дашборд не ломаем
  }, []);

  if (!hint?.show) return null;

  const snooze = async () => {
    try {
      await crmApi.snoozeHint();
      setHint(null);
      toast.success('Напомним через неделю');
    } catch {
      toast.error('Не получилось отложить, попробуйте ещё раз');
    }
  };

  return (
    <Card padding="md">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-block bg-accent-subtle flex items-center justify-center flex-shrink-0">
          <Link2 className="w-4 h-4 text-accent" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-fg">Звонки можно брать прямо из CRM</p>
          <p className="text-body text-fg-subtle mt-1">
            {hint.manualCalls && hint.manualCalls > 0
              ? `Ваша команда загрузила ${hint.manualCalls} ${plural(hint.manualCalls, 'запись', 'записи', 'записей')} файлами вручную. `
              : ''}
            Когда CRM подключена, менеджер выбирает звонок из списка сделок в два клика: не нужно
            искать файл, скачивать его и переносить. Экономит несколько минут на каждом разборе,
            а вы видите, к какой сделке относится разговор.
          </p>

          <div className="mt-2">
            <Button
              type="button"
              onClick={() => setExpanded(v => !v)}
              variant="link"
              size="sm"
            >
              Что для этого нужно
              <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
            </Button>
          </div>

          {expanded && (
            <ol className="mt-3 space-y-2 text-body text-fg-muted list-decimal list-inside">
              <li>
                Нужен администратор вашей CRM: тот, у кого есть права создать доступ в портале.
                Обычно это тот, кто настраивал воронки.
              </li>
              <li>
                Он открывает ссылку от платформы и вставляет туда доступ из своей CRM. Входить в
                платформу ему не нужно, ссылка одноразовая.
              </li>
              <li>
                Дальше вы связываете сотрудников CRM с людьми в платформе. Платформа предлагает
                совпадения сама, остаётся проверить.
              </li>
              <li>
                Всё. Менеджеры увидят вкладку «Из CRM» в добавлении звонка.
              </li>
            </ol>
          )}

          <div className="flex flex-wrap items-center gap-2 mt-4">
            {canConnect ? (
              <Button
                type="button"
                onClick={() => navigate('/settings?tab=integrations')}
                variant="primary"
                size="sm"
              >
                Перейти к подключению
              </Button>
            ) : (
              <p className="text-body text-fg-subtle">
                Подключение делает владелец компании или ваш трекер: покажите им эту страницу.
              </p>
            )}
            <Button
              type="button"
              onClick={snooze}
              variant="secondary"
              size="sm"
            >
              Напомнить через неделю
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
