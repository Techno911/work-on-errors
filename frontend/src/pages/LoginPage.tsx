import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { LoginShell, Button as ShellButton, Input as ShellInput, Checkbox } from '@chirkov/shell';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { Label } from '@/components/ui/input';
import { PLATFORM } from '@/config/platform';
import type { AxiosError } from 'axios';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);

  // Заголовок вкладки на входе — короткое имя платформы (канон §12).
  useEffect(() => {
    document.title = PLATFORM.short;
  }, []);

  const handleForgot = async () => {
    setError('');
    setForgotMsg('');
    if (!email.trim()) {
      setError('Введите email выше, и мы пришлём ссылку для восстановления пароля.');
      return;
    }
    setForgotBusy(true);
    try {
      await authApi.forgotPassword(email.trim());
      setForgotMsg('Если аккаунт с таким email существует, мы отправили на него ссылку для восстановления пароля. Проверьте почту (ссылка действует 1 час).');
    } catch {
      setError('Не удалось отправить письмо. Попробуйте ещё раз или обратитесь к куратору внедрения.');
    } finally {
      setForgotBusy(false);
    }
  };

  const { login } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = new URLSearchParams(location.search).get('redirect') ?? '/dashboard';

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const { data } = await authApi.login(email, password, rememberMe);
      login(data.accessToken, data.user);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // Сырой текст сервера наружу не показываем: только понятные русские сообщения
      const axiosError = err as AxiosError<{ message?: string }>;
      const serverMsg = axiosError.response?.data?.message;
      const isRussian = typeof serverMsg === 'string' && /[А-Яа-яЁё]/.test(serverMsg);
      const message = !axiosError.response
        ? 'Нет соединения. Проверьте интернет и попробуйте ещё раз.'
        : axiosError.response.status === 401 && isRussian
          ? serverMsg
          : 'Не удалось войти. Проверьте почту и пароль.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <LoginShell
      product={PLATFORM.product}
      company={PLATFORM.company}
      /* Переезд на @chirkov/shell 0.3.0 (23.09.2026): promise принимает только
         структурное обещание — заголовок, описание и ровно три пункта, пакет
         сам набирает их ступенью display, нумерует и оформляет значки. Своя
         вёрстка (кегль 28, свой цвет пунктов, ручной flex) отсюда убрана —
         навык chip-ui-law, «в наших экранах не бывает местной копии оболочки». */
      promise={{
        title: PLATFORM.product,
        description: PLATFORM.subtitle,
        items: PLATFORM.taglines,
      }}
      /* Надзаголовок, подвал и версия — только текст: кегль, гарнитуру, насыщенность,
         межбуквенный интервал, отступы и цвет (в т.ч. подвал/подпись бренда rgba(255,
         255,255,.45), канон 1.3) задаёт сам пакет. Локальные style-цвета сюда больше не
         кладём — это и есть «переопределять канон локально», чего делать нельзя. */
      overline="Рабочее пространство"
      footer={PLATFORM.copyright}
      version={__APP_VERSION__}
      form={
        <>
          {/* Заголовок формы: тег <h1> без своих классов — кегль 26, насыщенность 600
              и цвет задаёт .chip-login__form-column h1 пакета. Отступы вокруг (после
              надзаголовка, перед версией) тоже задаёт пакет — .chip-login__overline и
              .chip-login__version в 0.1.6 сами несут канон 1.3, локальных компенсаций
              margin-collapse больше не нужно. */}
          <div className="mb-8">
            <h1>С возвращением</h1>
            <p className="text-fg-subtle mt-1.5 text-body">
              Войдите, чтобы продолжить работу
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="bg-danger-subtle border border-danger text-danger-fg text-body rounded-block px-4 py-3">
                {error}
              </div>
            )}
            {forgotMsg && (
              <div className="bg-success-subtle border border-success-border text-success-fg text-body rounded-block px-4 py-3">
                {forgotMsg}
              </div>
            )}

            <div>
              <Label htmlFor="email">Email</Label>
              <ShellInput
                id="email"
                type="email"
                placeholder="manager@example.invalid"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
              />
            </div>

            <div>
              <Label htmlFor="password">Пароль</Label>
              <ShellInput
                id="password"
                type="password"
                minLength={6}
                placeholder="Введите пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <div className="flex items-center justify-between">
              <Checkbox
                label="Запомнить меня"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
              />
              {/* 0.1.6 добавил Button variant="link" — платформенная ghost-кнопка
                  больше не нужна на этом узле. */}
              <ShellButton type="button" variant="link" onClick={handleForgot} disabled={forgotBusy}>
                {forgotBusy ? 'Отправляем…' : 'Забыли пароль?'}
              </ShellButton>
            </div>

            <ShellButton
              type="submit"
              variant="primary"
              fullWidth
              disabled={isSubmitting}
              icon={
                isSubmitting ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-on-inverse border-t-transparent" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )
              }
            >
              {isSubmitting ? 'Вход...' : 'Войти'}
            </ShellButton>
          </form>
        </>
      }
    />
  );
}
