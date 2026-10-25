import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Wallet, AlertCircle, CheckCircle2, SlidersHorizontal, PauseCircle } from 'lucide-react';
import { ropBonusOfferApi, type RopBonusOfferInfo } from '@/api/rop-bonus-offer';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import type { AxiosError } from 'axios';
import { Button, Input, Card } from '@chirkov/shell';

function rub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}

// Экран предложения премии РОПа собственнику. Просмотр публичный по токену; решение
// (принять / настроить иначе / пока не вводим) — только под входом собственника этой компании.
export function RopBonusOfferPage() {
  const { token } = useParams<{ token: string }>();
  const { user, isAuthenticated, login, setUser, logout } = useAuthStore();

  const [info, setInfo] = useState<RopBonusOfferInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Результат действия в этой сессии (без перезагрузки страницы).
  const [outcome, setOutcome] = useState<'recommended' | 'customized' | 'declined' | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Форма входа собственника (владелец уже существует — принял оферту ранее).
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Режим «настроить иначе».
  const [customizing, setCustomizing] = useState(false);
  const [base, setBase] = useState(20000);
  const [minThreshold, setMinThreshold] = useState(60);
  const [payoutDay, setPayoutDay] = useState(0);

  useEffect(() => {
    if (!token) return;
    ropBonusOfferApi
      .getByToken(token)
      .then(({ data }) => {
        setInfo(data);
        if (data.draft) {
          setBase(data.draft.baseAmount);
          setMinThreshold(data.draft.minThresholdPct);
          setPayoutDay(data.draft.payoutDay ?? 0);
        }
      })
      .catch(() => setError('Предложение не найдено или уже недействительно'))
      .finally(() => setLoading(false));
  }, [token]);

  const canAct = isAuthenticated && (user?.role === 'owner' || user?.role === 'superadmin');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    if (!email.trim() || !password) {
      setLoginError('Введите email и пароль');
      return;
    }
    setLoggingIn(true);
    try {
      const { data } = await authApi.login(email.trim().toLowerCase(), password);
      login(data.accessToken, data.user);
      const { data: meData } = await authApi.me();
      setUser(meData.user);
      if (meData.user.role !== 'owner' && meData.user.role !== 'superadmin') {
        // Сбросить подменённую сессию: без этого владелец, по ошибке вошедший под логином подчинённого,
        // остался бы залогинен под чужой ролью и ушёл бы на /dashboard как менеджер.
        logout();
        setLoginError('Это решение принимает собственник компании. Войдите под аккаунтом владельца.');
      }
    } catch {
      setLoginError('Не удалось войти. Проверьте email и пароль.');
    } finally {
      setLoggingIn(false);
    }
  };

  const runAction = async (fn: () => Promise<{ decision: 'recommended' | 'customized' | 'declined' | null }>) => {
    if (!token) return;
    setSubmitting(true);
    try {
      const { decision } = await fn();
      setOutcome(decision);
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      toast.error(axiosError.response?.data?.message ?? 'Не удалось сохранить решение. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  };

  const doAccept = () => runAction(() => ropBonusOfferApi.accept(token!).then(r => r.data));
  const doDecline = () => runAction(() => ropBonusOfferApi.decline(token!).then(r => r.data));
  const doCustomize = () =>
    runAction(() =>
      ropBonusOfferApi
        .customize(token!, {
          baseAmount: base,
          minThresholdPct: minThreshold,
          payoutDay: payoutDay === 0 ? null : payoutDay,
          workdaysOnly: info?.draft?.workdaysOnly !== false,
        })
        .then(r => r.data),
    );

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas flex items-center justify-center py-8">
      <div className="max-w-md w-full mx-4">
        <Card padding="lg" elevation="raised">{children}</Card>
      </div>
    </div>
  );

  if (loading) {
    return shell(
      <div className="animate-pulse">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-full bg-border" />
          <div className="h-6 bg-border rounded-chip w-48" />
        </div>
        <div className="h-24 bg-surface-sunken rounded-block w-full mb-4" />
        <div className="h-12 bg-border rounded-block w-full" />
      </div>,
    );
  }

  if (error || !info) {
    return shell(
      <div className="text-center">
        <AlertCircle className="w-10 h-10 text-fg-disabled mx-auto mb-4" strokeWidth={1.5} />
        <h1 className="font-heading text-title font-bold text-fg mb-2">Предложение недействительно</h1>
        <p className="text-body text-fg-subtle mb-6">{error ?? 'Предложение не найдено.'}</p>
        <Link to="/login" className="inline-block bg-accent text-on-inverse px-6 py-2 rounded-control font-medium hover:bg-accent transition-colors">
          На главную
        </Link>
      </div>,
    );
  }

  // Итог: только что ответили в этой сессии, либо уже отвечали ранее.
  const decided = outcome ?? (info.responded ? info.decision : null);
  if (decided) {
    const meta = {
      recommended: { icon: <CheckCircle2 className="w-10 h-10 text-success" strokeWidth={1.5} />, title: 'Премия подключена', text: `Расчёт запустится с первого полного месяца работы. Платформа сама посчитает процент разборов в срок и покажет РОПу прогресс. Не забудьте оформить премию Положением о премировании: это остаётся за вами как за собственником.` },
      customized: { icon: <SlidersHorizontal className="w-10 h-10 text-accent" strokeWidth={1.5} />, title: 'Ваш вариант отправлен', text: 'Мы получили вашу настройку и согласуем детали. После согласования премия подключится в вашем пространстве.' },
      declined: { icon: <PauseCircle className="w-10 h-10 text-fg-disabled" strokeWidth={1.5} />, title: 'Пока отложено', text: 'Отметили, что премию РОПа сейчас не вводим: платформа её не считает и руководителю не показывает. Включить можно в любой момент самому, в настройках платформы: «Нормативы → Премия РОПа».' },
    }[decided];
    return shell(
      <div className="text-center">
        <div className="flex justify-center mb-4">{meta.icon}</div>
        <h1 className="font-heading text-title font-bold text-fg mb-2">{meta.title}</h1>
        <p className="text-body text-fg-subtle mb-6">{meta.text}</p>
        <Link to="/dashboard" className="inline-block bg-accent text-on-inverse px-6 py-2 rounded-control font-medium hover:bg-accent transition-colors">
          В пространство
        </Link>
      </div>,
    );
  }

  const d = info.draft;
  const sourceText =
    info.source === 'contract'
      ? 'Сумма взята из вашего договора (приложение о премировании ответственного за продажи).'
      : 'Сумма подобрана по практике внедрения. Вы можете изменить её кнопкой «Настроить иначе».';

  return shell(
    <>
      <div className="text-center mb-6">
        <div className="flex justify-center mb-3">
          <Wallet className="w-10 h-10 text-accent" strokeWidth={1.5} />
        </div>
        <h1 className="font-heading text-section font-bold text-fg mb-1">Премия для вашего РОПа</h1>
        <p className="text-body text-fg-subtle">
          {info.companyName} · {info.ropName}
        </p>
      </div>

      <div className="text-body text-fg-muted space-y-3 mb-5">
        <p>
          Чтобы разбор ошибок в отделе продаж не затухал, мы рекомендуем привязать премию руководителя к дисциплине разборов.
          Платформа считает её автоматически и показывает РОПу прогресс к цели каждый месяц.
        </p>
      </div>

      {/* Карточка рекомендации */}
      {d && (
        <div className="bg-accent-subtle border border-accent-muted rounded-block p-4 mb-4 text-body space-y-2">
          <p className="font-semibold text-fg text-body-lg">Как считается премия</p>
          <p className="text-body text-fg-muted">
            Базовая сумма <b className="text-fg">{rub(d.baseAmount)}</b> умножается на процент разборов, сделанных в срок за месяц.
          </p>
          <p className="text-body text-fg-muted">
            Если в срок сделано меньше <b className="text-fg">{d.minThresholdPct}%</b>, премия за этот месяц не начисляется:
            это защищает смысл разбора, а не просто «галочки».
          </p>
          {d.payoutDay ? (
            <p className="text-body text-fg-subtle">Расчёт за прошлый месяц приходит {d.payoutDay}-го числа.</p>
          ) : null}
          <p className="text-body text-fg-subtle pt-1 border-t border-accent-muted">{sourceText}</p>
        </div>
      )}

      {/* Действия: доступны только под входом собственника */}
      {canAct ? (
        <div className="space-y-3">
          {!customizing ? (
            <>
              <Button
                type="button"
                onClick={doAccept}
                disabled={submitting}
                fullWidth
              >
                {submitting ? 'Подключаем…' : 'Принять рекомендацию'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCustomizing(true)}
                disabled={submitting}
                fullWidth
                icon={<SlidersHorizontal />}
              >
                Настроить иначе
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={doDecline}
                disabled={submitting}
                fullWidth
              >
                Пока не вводим
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor="rb-base" className="block text-body font-medium text-fg mb-1">Базовая сумма, ₽</label>
                <Input
                  id="rb-base"
                  type="number"
                  value={base}
                  min={0}
                  step={1000}
                  onChange={e => setBase(Math.max(0, Number(e.target.value)))}
                />
              </div>
              <div>
                <label htmlFor="rb-threshold" className="block text-body font-medium text-fg mb-1">Отсечка, % (ниже неё премия 0)</label>
                <Input
                  id="rb-threshold"
                  type="number"
                  value={minThreshold}
                  min={1}
                  max={100}
                  onChange={e => setMinThreshold(Math.max(1, Math.min(100, Number(e.target.value))))}
                />
              </div>
              <div>
                <label htmlFor="rb-payout" className="block text-body font-medium text-fg mb-1">День выплаты (0 = не назначать)</label>
                <Input
                  id="rb-payout"
                  type="number"
                  value={payoutDay}
                  min={0}
                  max={28}
                  onChange={e => setPayoutDay(Math.max(0, Math.min(28, Number(e.target.value))))}
                />
              </div>
              <p className="text-micro text-fg-subtle">
                Ваш вариант уйдёт нам на согласование, а не сразу в работу: так мы сверим сумму с договором и оформлением.
              </p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Button
                    type="button"
                    onClick={doCustomize}
                    disabled={submitting}
                    fullWidth
                  >
                    {submitting ? 'Отправляем…' : 'Отправить вариант'}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCustomizing(false)}
                  disabled={submitting}
                >
                  Назад
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={handleLogin} className="space-y-3">
          <p className="text-body text-fg-muted">
            Войдите под аккаунтом собственника, чтобы принять решение. Это тот же логин, которым вы приняли оферту.
          </p>
          <div>
            <label htmlFor="rb-email" className="block text-body font-medium text-fg mb-1">Email</label>
            <Input
              id="rb-email"
              type="email"
              placeholder="you@example.invalid"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="rb-password" className="block text-body font-medium text-fg mb-1">Пароль</label>
            <Input
                id="rb-password"
                type="password"
                placeholder="Ваш пароль"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
          </div>
          {loginError && (
            <div className="bg-danger-subtle border border-danger-border rounded-card px-3 py-2 text-body text-danger-fg">{loginError}</div>
          )}
          <Button
            type="submit"
            disabled={loggingIn}
            fullWidth
          >
            {loggingIn ? 'Входим…' : 'Войти и посмотреть'}
          </Button>
        </form>
      )}
    </>,
  );
}
