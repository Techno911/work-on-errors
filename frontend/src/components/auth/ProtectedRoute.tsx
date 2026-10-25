import { useEffect } from 'react';
import { Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { usePaymentHold, PaymentHoldScreen } from '@/components/access/PaymentHold';

export function ProtectedRoute() {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const hold = usePaymentHold();

  // Мастера настройки у владельца больше нет: пространство настраивает трекер до его первого
  // входа, поэтому владелец попадает сразу в продукт. Единственное решение, которое нельзя
  // принять за него (премия РОПа), ждёт карточкой на дашборде и ничего не блокирует.

  // Личное согласие РОПа/менеджера на ПДн (ст. 88 ТК РФ) — работодатель не может дать его
  // за сотрудника, поэтому это отдельный гейт под логином самого сотрудника (не пункт оферты).
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (location.pathname === '/pdn-consent') return;
    const needsConsent = (user.role === 'reviewer' || user.role === 'manager') && !user.pdnConsentAcceptedAt;
    if (needsConsent) {
      navigate('/pdn-consent', { replace: true });
    }
  }, [isAuthenticated, user, location.pathname, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Приостановка за неоплату: ни одного защищённого экрана не рисуем. Проверка стоит здесь, а не
  // в оболочке приложения, потому что часть экранов живёт ВНЕ оболочки (согласие на ПДн), и
  // человек в приостановленной компании упирался бы в форму, которую сервер всё равно закроет.
  if (hold.blocked) {
    return <PaymentHoldScreen since={hold.since} note={hold.note} companyName={hold.companyName} />;
  }

  return <Outlet />;
}
