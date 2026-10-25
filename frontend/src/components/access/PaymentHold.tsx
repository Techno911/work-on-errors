import { useEffect, useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { companiesApi } from '@/api/companies';
import { authApi } from '@/api/auth';
import { Button, Notice, Card } from '@chirkov/shell';

/**
 * Приостановка работы за неоплату: то, что видит команда клиента.
 *
 * Экран ЗАМЕНЯЕТ платформу, а не накрывает её. Разница не косметическая: под накрывающим окном
 * страницы продолжают жить и запрашивать данные, сервер отвечает отказом, и человек поверх
 * объяснения получает череду красных сообщений об ошибках. Заменяя оболочку, мы не рисуем ни
 * одной страницы, поэтому и запросов нет.
 *
 * Что здесь важно по существу:
 *   · менеджеру и РОПу не показываем сумму и номер счёта: это разговор собственника с нами,
 *     а не повод человеку краснеть перед своей командой;
 *   · прямым текстом сказано, что данные на месте: иначе первая мысль будет «нас удалили»;
 *   · выход оставлен: запирать человека в экране без единого действия невежливо.
 *
 * Состояние перечитывается раз в минуту и сразу после отказа сервера, поэтому экран приходит
 * и уходит сам, без просьбы «перезайдите».
 */

const TEAM_ROLES = ['owner', 'reviewer', 'manager'];
const POLL_MS = 60_000;

/** Событие от axios: сервер ответил отказом с кодом PAYMENT_HOLD. */
export const PAYMENT_HOLD_EVENT = 'payment-hold:detected';

export interface PaymentHoldState {
  blocked: boolean;
  since: string | null;
  note: string | null;
  companyName: string | null;
}

/**
 * Состояние приостановки. Стартовое значение приходит вместе с профилем (auth/me отдаёт
 * company.paymentHold), поэтому экран поднимается ДО первого рендера страниц, а не после.
 */
export function usePaymentHold(): PaymentHoldState {
  const user = useAuthStore(s => s.user);
  const role = user?.role ?? '';
  const watched = TEAM_ROLES.includes(role);
  const fromProfile = user?.company?.paymentHold === true;

  const [state, setState] = useState<PaymentHoldState>({
    blocked: fromProfile,
    since: null,
    note: null,
    companyName: user?.company?.name ?? null,
  });

  useEffect(() => {
    if (!watched) {
      setState({ blocked: false, since: null, note: null, companyName: null });
      return;
    }
    let alive = true;
    const load = async () => {
      try {
        const { data } = await companiesApi.getAccessState();
        if (!alive) return;
        setState({
          blocked: data.paymentHold === true,
          since: data.since,
          note: data.note,
          companyName: data.companyName ?? null,
        });
      } catch {
        // Сеть отвалилась: своего мнения о приостановке не выдумываем, оставляем прежнее.
      }
    };
    load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener(PAYMENT_HOLD_EVENT, load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener(PAYMENT_HOLD_EVENT, load);
    };
  }, [watched, user?.id]);

  return watched ? state : { blocked: false, since: null, note: null, companyName: null };
}

export function PaymentHoldScreen({ since, note, companyName }: Omit<PaymentHoldState, 'blocked'>) {
  const role = useAuthStore(s => s.user?.role);
  const logout = useAuthStore(s => s.logout);
  const isOwner = role === 'owner';

  const sinceLabel = since
    ? new Date(since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const doLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Выйти надо в любом случае: токен живёт в памяти вкладки.
    }
    logout();
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <Card padding="none" elevation="raised" className="overflow-hidden">
        <div className="px-6 pt-6 pb-5" style={{ backgroundColor: 'var(--color-accent-subtle)' }}>
          <div
            className="w-11 h-11 rounded-block flex items-center justify-center mb-3"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            <Lock className="w-5 h-5 text-on-inverse" />
          </div>
          <h1 className="font-heading text-title font-bold text-fg">
            Работа платформы приостановлена
          </h1>
          <p className="text-body text-fg-muted mt-1">
            {companyName ? `Компания «${companyName}»` : 'Ваша компания'}
            {sinceLabel ? `, с ${sinceLabel}` : ''}
          </p>
        </div>

        <div className="px-6 py-5 space-y-4">
          {isOwner ? (
            <>
              <p className="text-body-lg text-fg">
                Доступ команды к платформе закрыт до оплаты. Как только оплата поступит, мы снимем
                приостановку, и работа продолжится с того места, где остановилась.
              </p>
              {note && (
                <Notice tone="warning" title="К оплате">
                  <span className="whitespace-pre-line">{note}</span>
                </Notice>
              )}
              <p className="text-body-lg text-fg">
                Если оплата уже прошла или есть вопрос по расчётам, напишите в рабочий чат с командой
                «Чирков и партнёры». Ответим и откроем доступ.
              </p>
            </>
          ) : (
            <>
              <p className="text-body-lg text-fg">
                Доступ закрыт по вопросу оплаты между вашей компанией и командой «Чирков и партнёры».
                К вашей работе это отношения не имеет, и действий от вас не требует.
              </p>
              <p className="text-body-lg text-fg">
                Что делать: сообщите собственнику компании. Как только вопрос решится, доступ
                откроется, и вы продолжите с того места, где остановились.
              </p>
            </>
          )}

          <p className="text-body text-fg-subtle">
            Все записи, разборы и настройки сохранены. Ничего не удалено и не потеряно.
          </p>
        </div>

        <div className="px-6 py-4 bg-canvas border-t border-border flex items-center justify-between gap-3 flex-wrap">
          <p className="text-micro text-fg-subtle">Страница откроется сама, как только доступ вернут.</p>
          <Button
            type="button"
            onClick={doLogout}
            variant="secondary"
            size="md"
            icon={<LogOut />}
          >
            Выйти
          </Button>
        </div>
      </Card>
      </div>
    </div>
  );
}
