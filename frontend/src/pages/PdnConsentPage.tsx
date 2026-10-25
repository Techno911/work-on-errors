import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck } from 'lucide-react';
import { usersApi } from '@/api/users';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { Button, Checkbox, Card } from '@chirkov/shell';

/**
 * Экран первого входа РОПа/менеджера: два САМОСТОЯТЕЛЬНЫХ акта, оба обязательны.
 * 1) Личное согласие на обработку ПДн (ст. 88 ТК РФ) — работодатель не может дать его
 *    за работника, поэтому это отдельный экран под собственным логином сотрудника,
 *    а не пункт оферты, которую подписывал владелец.
 * 2) Ознакомление с положением о ПДн работодателя (ст. 86 ч. 8 ТК РФ) — отдельная
 *    обязанность, не то же самое, что согласие на передачу выше.
 * Нажатие кнопки — простая электронная подпись (63-ФЗ ст. 9): действие совершено под
 * аутентификацией сотрудника, платформа логирует момент и IP.
 */
export function PdnConsentPage() {
  const navigate = useNavigate();
  const { setUser } = useAuthStore();
  const [agreedPdn, setAgreedPdn] = useState(false);
  const [agreedLna, setAgreedLna] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = agreedPdn && agreedLna;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await usersApi.submitPdnConsent();
      const { data } = await authApi.me();
      setUser(data.user);
      toast.success('Спасибо, доступ открыт');
      navigate('/', { replace: true });
    } catch {
      toast.error('Не удалось сохранить согласие. Попробуйте ещё раз.', { duration: Infinity });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center py-8">
      <div className="max-w-lg w-full mx-4">
        <Card padding="lg" elevation="raised">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <ShieldCheck className="w-10 h-10 text-accent" strokeWidth={1.5} />
          </div>
          <h1 className="font-heading text-section font-bold text-fg mb-2">Прежде чем продолжить</h1>
          <p className="text-body text-fg-subtle">Два коротких пункта, обязательны для первого входа в платформу.</p>
        </div>

        <div className="bg-accent-subtle border border-accent-muted rounded-block p-4 mb-4 text-body text-fg-muted space-y-2">
          <p className="font-semibold text-fg text-body-lg">1. Согласие на обработку персональных данных</p>
          <p>
            Ваш работодатель использует платформу «Работа над ошибками» для контроля качества работы отдела продаж.
            Вы даёте согласие на обработку исполнителем (обработчиком по поручению работодателя) ваших персональных
            данных: ФИО, роль, аудиозаписи и тексты ваших звонков/переписок, тексты самоанализа, результаты оценки
            эффективности. Цель: оказание услуг платформы (загрузка звонков, самоанализ, ревью, аналитика).
          </p>
          <p>
            Данные хранятся на серверах исполнителя на территории РФ и удаляются после завершения работы по запросу
            работодателя. Согласие можно отозвать письменным обращением работодателю.
          </p>
        </div>

        <div className="mb-4">
          <Checkbox
            checked={agreedPdn}
            onChange={e => setAgreedPdn(e.target.checked)}
            label="Я ознакомлен(а) и даю согласие на обработку моих персональных данных на условиях выше."
          />
        </div>

        <Card padding="sm" surface="canvas" radius="block" className="mb-4 text-body text-fg-muted space-y-2">
          <p className="font-semibold text-fg text-body-lg">2. Положение о персональных данных</p>
          <p>
            Ваш работодатель обязан ознакомить вас с порядком обработки персональных данных сотрудников и вашими
            правами в этой сфере (право на доступ к своим данным, право на отзыв согласия, право на обращение
            с жалобой в уполномоченный орган). Уточните у своего руководителя действующее положение, если оно
            не было предоставлено отдельно.
          </p>
        </Card>

        <div className="mb-6">
          <Checkbox
            checked={agreedLna}
            onChange={e => setAgreedLna(e.target.checked)}
            label="Я ознакомлен(а) с порядком обработки персональных данных сотрудников."
          />
        </div>

        <Button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          fullWidth
        >
          {submitting ? 'Сохраняем...' : 'Подтвердить и продолжить'}
        </Button>

        <p className="text-micro text-fg-subtle text-center mt-4">
          Нажимая кнопку, вы используете простую электронную подпись: это подтверждает подлинность
          вашего согласия наравне с собственноручной подписью (ст. 9 63-ФЗ).
        </p>
      </Card>
      </div>
    </div>
  );
}
