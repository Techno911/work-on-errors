import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';
import { offerApi } from '@/api/offer';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import type { AxiosError } from 'axios';
import { Button, Checkbox, Input, Card } from '@chirkov/shell';

export function OfferPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { login, setUser } = useAuthStore();

  const [companyName, setCompanyName] = useState('');
  // Заказчик в оферте — юрлицо/ИП из договора (если внесено), иначе бренд компании.
  const [legalName, setLegalName] = useState<string | null>(null);
  const [legalInn, setLegalInn] = useState<string | null>(null);
  // Точный срок теста (в оферте недопустимо «около месяца»).
  const [trialDays, setTrialDays] = useState(30);
  // Режим лицензии: trial (бесплатный тест N дней) или implementation (команда уже во внедрении —
  // лицензия бесплатна на весь этап, счётчик триала не показываем).
  const [licenseMode, setLicenseMode] = useState<'trial' | 'implementation'>('trial');
  // Конкретные даты теста для показа в оферте (триал считается от старта работы, а не от акцепта).
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [workStartedAt, setWorkStartedAt] = useState<string | null>(null);
  const [alreadyAccepted, setAlreadyAccepted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Раздельно: акцепт оферты и согласие на ПДн — ДВА самостоятельных действия, не одно
  // (с 01.09.2025 согласие на ПДн обязано быть отдельным документом, не совмещённым
  // с акцептом других условий — ст. 9 ч. 1 152-ФЗ).
  const [agreedOffer, setAgreedOffer] = useState(false);
  const [agreedPdn, setAgreedPdn] = useState(false);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    offerApi
      .getByToken(token)
      .then(({ data }) => {
        setCompanyName(data.companyName);
        setLegalName(data.legalName);
        setLegalInn(data.inn);
        setTrialDays(data.trialDays);
        setLicenseMode(data.licenseMode ?? 'trial');
        setTrialEndsAt(data.trialEndsAt);
        setWorkStartedAt(data.workStartedAt);
        setAlreadyAccepted(data.accepted);
      })
      .catch(() => setError('Оферта не найдена или уже недействительна'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!fullName.trim()) {
      setFormError('Введите ваше имя');
      return;
    }
    if (!email.trim()) {
      setFormError('Введите ваш email');
      return;
    }
    if (password.length < 6) {
      setFormError('Пароль должен содержать не менее 6 символов');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Пароли не совпадают');
      return;
    }
    if (!agreedOffer) {
      setFormError('Подтвердите принятие оферты, чтобы продолжить');
      return;
    }
    if (!agreedPdn) {
      setFormError('Подтвердите согласие на обработку персональных данных, чтобы продолжить');
      return;
    }
    if (!token) return;

    setSubmitting(true);
    try {
      // 1. Регистрируем владельца
      const { data: authData } = await authApi.register(email.trim().toLowerCase(), password, fullName.trim(), { offerToken: token });
      login(authData.accessToken, authData.user);
      // 2. Принимаем оферту: пользователь становится владельцем компании, стартует триал
      await offerApi.accept(token, agreedPdn);
      // 3. Обновляем профиль (companyId + роль owner из токена)
      const { data: meData } = await authApi.me();
      setUser(meData.user);
      toast.success('Оферта принята. Добро пожаловать');
      navigate('/onboarding');
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      const msg = (axiosError.response?.data?.message ?? '').toLowerCase();
      if (msg.includes('уже зарегистрирован') || msg.includes('already exists') || msg.includes('уже существует')) {
        setFormError('Пользователь с таким email уже зарегистрирован. Войдите в аккаунт и откройте ссылку снова.');
      } else {
        setFormError('Не удалось принять оферту. Попробуйте ещё раз.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Склонение «день/дня/дней» для точного срока теста.
  const daysWord = (n: number) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'день';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
    return 'дней';
  };

  // Дата в человекочитаемом виде (в оферте нужна точность «до такого-то числа», а не «около месяца»).
  const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center py-8">
        <div className="max-w-md w-full mx-4">
          <Card padding="lg" elevation="raised" className="animate-pulse">
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-border" />
            <div className="h-6 bg-border rounded-chip w-40" />
          </div>
          <div className="h-12 bg-border rounded-block w-full" />
        </Card>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <Card padding="lg" elevation="raised" className="text-center">
          <div className="flex justify-center mb-4">
            <AlertCircle className="w-10 h-10 text-fg-disabled" strokeWidth={1.5} />
          </div>
          <h1 className="font-heading text-title font-bold text-fg mb-2">Оферта недействительна</h1>
          <p className="text-body text-fg-subtle mb-6">{error}</p>
          <Link to="/login" className="inline-block bg-accent text-on-inverse px-6 py-2 rounded-control font-medium hover:bg-accent transition-colors">
            На главную
          </Link>
        </Card>
        </div>
      </div>
    );
  }

  if (alreadyAccepted) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <Card padding="lg" elevation="raised" className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="w-10 h-10 text-success" strokeWidth={1.5} />
          </div>
          <h1 className="font-heading text-title font-bold text-fg mb-2">Оферта уже принята</h1>
          <p className="text-body text-fg-subtle mb-6">Доступ к пространству «{companyName}» уже активирован. Войдите в аккаунт.</p>
          <Link to="/login" className="inline-block bg-accent text-on-inverse px-6 py-2 rounded-control font-medium hover:bg-accent transition-colors">
            Войти
          </Link>
        </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center py-8">
      <div className="max-w-md w-full mx-4">
        <Card padding="lg" elevation="raised">
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <ShieldCheck className="w-10 h-10 text-accent" strokeWidth={1.5} />
          </div>
          <h1 className="font-heading text-section font-bold text-fg mb-2">Подключение к платформе</h1>
          <p className="text-body text-fg-subtle">
            Пространство «{companyName}» готово. Примите оферту, чтобы активировать доступ команды.
          </p>
        </div>

        {/* Полный текст оферты — виден целиком, без внутреннего микроскролла (скроллится страница).
            Согласие на ПДн вынесено в ОТДЕЛЬНЫЙ блок со своим чекбоксом ниже (не пункт оферты) —
            с 01.09.2025 согласие на ПДн обязано быть отдельным документом, не совмещённым
            с акцептом других условий (ст. 9 ч. 1 152-ФЗ). */}
        <div className="bg-accent-subtle border border-accent-muted rounded-block p-4 mb-5 text-body text-fg-muted space-y-3">
          <p className="font-semibold text-fg text-body-lg">Оферта на использование платформы «Работа над ошибками»</p>

          <div className="space-y-1">
            <p className="text-body font-medium text-fg">1. Предмет</p>
            <p>Исполнитель предоставляет компании «{companyName}» доступ к платформе «Работа над ошибками» для работы команды (руководителя, РОПа и менеджеров): загрузка звонков и переписок, самоанализ, ревью, спринты и аналитика.</p>
            {legalName && (
              <p className="text-body text-fg-muted">Заказчик: {legalName}{legalInn ? `, ИНН ${legalInn}` : ''}.</p>
            )}
          </div>

          {licenseMode === 'implementation' ? (
            <div className="space-y-1">
              <p className="text-body font-medium text-fg">2. Бесплатный доступ на время внедрения</p>
              <p>Пока идёт внедрение, платформа предоставляется бесплатно на весь этап. Отдельная плата за платформу на этот срок не взимается, переживать о сроках не нужно.</p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-body font-medium text-fg">2. Бесплатный тестовый период</p>
                {trialEndsAt ? (
                  <p>
                    На время теста платформа предоставляется бесплатно. Тестовый период: {trialDays} {daysWord(trialDays)}
                    {workStartedAt ? `, с ${fmtDate(workStartedAt)}` : ''} по{' '}
                    <span className="font-semibold text-fg">{fmtDate(trialEndsAt)}</span> включительно.
                    До этой даты пользование платформой бесплатно.
                  </p>
                ) : (
                  <p>Тестовый период {trialDays} {daysWord(trialDays)} предоставляется бесплатно. Он отсчитывается со старта фактической работы вашего маркетолога (фиксируется по рабочему чату команды), а не с момента принятия этой оферты: если специалист ещё нанимается, тест не сгорает. Точную дату окончания теста вы увидите после старта работы.</p>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-body font-medium text-fg">3. Продолжение после теста</p>
                <p>Если после теста вы продолжаете внедрение, платформа остаётся бесплатной на весь этап внедрения. Отдельная плата за платформу на этот срок не взимается.</p>
              </div>
            </>
          )}

          <div className="space-y-1">
            <p className="text-body font-medium text-fg">{licenseMode === 'implementation' ? '3' : '4'}. Срок и прекращение</p>
            <p>Вы можете прекратить использование платформы в любой момент, сообщив исполнителю. После прекращения доступ команды закрывается, данные удаляются.</p>
          </div>
        </div>

        {/* Отдельный документ согласия на ПДн — намеренно НЕ внутри блока оферты выше и со своим
            чекбоксом ниже (ст. 9 ч. 1 152-ФЗ, требование действует с 01.09.2025). */}
        <Card padding="sm" surface="canvas" radius="block" className="mb-5 text-body text-fg-muted space-y-2">
          <p className="font-semibold text-fg text-body-lg">Согласие на обработку персональных данных команды</p>
          <p>
            Как владелец компании «{companyName}» вы поручаете исполнителю (обработчику) обработку персональных данных вашей
            команды в объёме: ФИО, роль, аудиозаписи и тексты звонков/переписок, тексты самоанализа, результаты оценки
            эффективности. Цель обработки: оказание услуг платформы (загрузка звонков, самоанализ, ревью, аналитика).
          </p>
          <p>
            Данные хранятся и обрабатываются на серверах исполнителя на территории РФ, используются только для оказания
            услуги и удаляются после завершения работы по вашему запросу. Согласие можно отозвать письменным обращением
            исполнителю: доступ команды к платформе будет прекращён.
          </p>
          <p className="text-body text-fg-subtle">
            Обработка ПДн самих сотрудников (РОП, менеджеров) в отношениях с работодателем регулируется отдельно.
            Рекомендуем получить согласие каждого сотрудника и ознакомить его с порядком обработки до подключения
            к платформе (гл. 14 ТК РФ).
          </p>
        </Card>

        <form onSubmit={handleAccept} className="space-y-4">
          <div>
            <label className="block text-body font-medium text-fg mb-1">
              Ваше имя <span className="text-accent">*</span>
            </label>
            <Input
              type="text"
              placeholder="Иван Иванов"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-body font-medium text-fg mb-1">
              Email <span className="text-accent">*</span>
            </label>
            <Input
              type="email"
              placeholder="you@example.invalid"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-body font-medium text-fg mb-1">
              Пароль <span className="text-accent">*</span>
            </label>
            <Input
                type="password"
                placeholder="Минимум 6 символов"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
          </div>

          <div>
            <label className="block text-body font-medium text-fg mb-1">
              Повторите пароль <span className="text-accent">*</span>
            </label>
            <Input
              type="password"
              placeholder="Повторите пароль"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2.5">
            <Checkbox
              checked={agreedOffer}
              onChange={e => setAgreedOffer(e.target.checked)}
              label="Я принимаю оферту на использование платформы «Работа над ошибками»."
            />
            <Checkbox
              checked={agreedPdn}
              onChange={e => setAgreedPdn(e.target.checked)}
              label="Я даю согласие на обработку персональных данных команды на условиях, указанных выше."
            />
          </div>

          {formError && (
            <div className="bg-danger-subtle border border-danger-border rounded-card px-3 py-2 text-body text-danger-fg">
              {formError}
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting}
            fullWidth
          >
            {submitting ? 'Активируем доступ…' : 'Принять и активировать'}
          </Button>
        </form>
      </Card>
      </div>
    </div>
  );
}
