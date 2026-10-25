import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, MessageCircle, X } from 'lucide-react';
import { ropBonusOfferApi, type RopBonusSetup } from '@/api/rop-bonus-offer';
import { Button, Card } from '@chirkov/shell';

const rub = (n: number) => new Intl.NumberFormat('ru-RU').format(n) + ' ₽';

/**
 * Карточка на дашборде владельца: единственное решение онбординга, которое нельзя принять за него.
 * Раньше жила шагом мастера и держала владельца шлагбаумом на входе; теперь просто ждёт на главной
 * и исчезает, как только решение принято. «Согласен» подключает премию, «Обсудить с трекером»
 * помечает шаг на согласование (трекер видит горящий шаг в карточке компании), «Премия не нужна»
 * выключает премию и закрывает шаг как осознанное решение.
 *
 * Третий ответ появился 16.09.2026: владелец клиента написал нам «руководитель работает без премии,
 * можно её выключить?» — на карточке сказать это было нечем, и решение шло через переписку.
 */
export function RopBonusProposalCard() {
  const [rec, setRec] = useState<RopBonusSetup | null>(null);
  const [ropName, setRopName] = useState('');
  const [responded, setResponded] = useState(false);
  const [busy, setBusy] = useState(false);
  // Отказ — решение про деньги человека, поэтому подтверждается тут же, вторым нажатием.
  const [confirmDecline, setConfirmDecline] = useState(false);

  useEffect(() => {
    ropBonusOfferApi.getSelf()
      .then(({ data }) => {
        setRec(data.draft);
        setRopName(data.ropName);
        setResponded(data.responded);
      })
      .catch(() => {});
  }, []);

  const accept = async () => {
    setBusy(true);
    try {
      await ropBonusOfferApi.acceptSelf();
      setResponded(true);
      toast.success('Премия для руководителя подключена');
    } catch {
      toast.error('Не удалось сохранить. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setBusy(false);
    }
  };

  const discuss = async () => {
    setBusy(true);
    try {
      await ropBonusOfferApi.discussSelf();
      setResponded(true);
      toast.success('Трекер свяжется с вами и обсудит премию');
    } catch {
      toast.error('Не удалось сохранить. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      await ropBonusOfferApi.declineSelf();
      setResponded(true);
      setConfirmDecline(false);
      toast.success('Записали: премии за работу над ошибками не будет. Включить можно в настройках, раздел «Нормативы»');
    } catch {
      toast.error('Не удалось сохранить. Попробуйте ещё раз', { duration: Infinity });
    } finally {
      setBusy(false);
    }
  };

  // Решение принято (в этой сессии или раньше) — карточке на дашборде делать нечего.
  if (responded || !rec) return null;

  return (
    <Card padding="md" tone="accent" className="mb-6">
      <h2 className="font-heading font-semibold text-fg mb-1">Премия для руководителя отдела продаж</h2>
      <p className="text-body text-fg-subtle mb-4">
        Отдельная премия руководителю за работу на платформе делает разборы системными. По нашей практике это заметно поднимает вовлечённость и результат команды.
      </p>

      {rec ? (
        <div className="space-y-4">
          <div className="rounded-block border border-accent-muted bg-accent-subtle p-4">
            <p className="text-body font-semibold text-fg mb-1">Наша рекомендация</p>
            <p className="text-body text-fg-subtle">
              Базовая часть <span className="font-semibold text-fg">{rub(rec.baseAmount)}</span>, умноженная на процент разборов, сданных в срок и принятых.
              Если в срок сдано меньше {rec.minThresholdPct}%, премия за месяц не начисляется: так у руководителя есть стимул довести разборы до результата.
            </p>
          </div>
          {confirmDecline ? (
            <div className="rounded-block border border-border bg-surface-sunken p-4 space-y-3">
              <p className="text-body text-fg-muted">
                Премии за работу над ошибками не будет. Кого это касается: {ropName}. Карточка премии на главной
                пропадёт, расчёт выплаты платформа считать перестанет. Уже посчитанные месяцы останутся в истории,
                а включить премию можно в любой момент в настройках, раздел «Нормативы».
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  size="md"
                  type="button"
                  onClick={decline}
                  disabled={busy}
                  icon={<Check />}
                >
                  Да, премии не будет
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  type="button"
                  onClick={() => setConfirmDecline(false)}
                  disabled={busy}
                >
                  Отмена
                </Button>
              </div>
            </div>
          ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="md"
              type="button"
              onClick={accept}
              disabled={busy}
              icon={<Check />}
            >
              Согласен, подключить
            </Button>
            <Button
              variant="secondary"
              size="md"
              type="button"
              onClick={discuss}
              disabled={busy}
              icon={<MessageCircle />}
            >
              Обсудить с трекером
            </Button>
            <Button
              variant="ghost"
              size="md"
              type="button"
              onClick={() => setConfirmDecline(true)}
              disabled={busy}
              icon={<X />}
            >
              Премия не нужна
            </Button>
          </div>
          )}
        </div>
      ) : (
        <p className="text-body text-fg-subtle">Загружаем рекомендацию…</p>
      )}
    </Card>
  );
}
