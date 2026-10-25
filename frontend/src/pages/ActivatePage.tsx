import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/stores/authStore';
import { Label } from '@/components/ui/input';
import { BrandMark, Button, Input, Card } from '@chirkov/shell';
import { TelegramLinkButton } from '@/components/settings/TelegramLinkButton';
import type { AxiosError } from 'axios';

/**
 * Первый вход по именной ссылке (волна 3 разбора жизненного цикла, 05.08.2026).
 *
 * Пароль в чат больше не уходит: он живёт в переписке дольше, чем нужно, и передаётся через
 * третьи руки. Человек открывает свою ссылку, придумывает пароль сам, сразу оказывается внутри
 * платформы, и следующим шагом ему предлагают привязать личный Telegram — тогда напоминания
 * идут ему в личку, а не в общий чат.
 */
export function ActivatePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const [who, setWho] = useState<{ fullName: string; email: string; companyName: string | null } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    authApi
      .describeActivation(token)
      .then(({ data }) => setWho(data))
      .catch((err) => {
        const axiosError = err as AxiosError<{ message?: string }>;
        const msg = axiosError.response?.data?.message;
        setLoadError(
          typeof msg === 'string' && /[А-Яа-яЁё]/.test(msg)
            ? msg
            : 'Ссылка недействительна или уже использована. Попросите выслать новую.',
        );
      });
  }, [token]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Пароль должен быть не короче 6 символов.');
      return;
    }
    if (password !== confirm) {
      setError('Пароли не совпадают.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await authApi.activate(token, password);
      login(data.accessToken, data.user);
      setDone(true);
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      const msg = axiosError.response?.data?.message;
      setError(
        typeof msg === 'string' && /[А-Яа-яЁё]/.test(msg)
          ? msg
          : 'Не удалось задать пароль. Попросите выслать ссылку заново.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: 'var(--color-canvas)' }}>
      <div className="w-full max-w-sm">
        <Card padding="lg" elevation="raised">
        <div className="flex justify-center mb-6" style={{ color: 'var(--color-fg)' }}>
          <BrandMark size={48} />
        </div>

        {!token || loadError ? (
          <div className="text-center">
            <h1 className="text-title text-fg font-semibold">Ссылка не работает</h1>
            <p className="text-body text-fg-subtle mt-1">{loadError || 'Откройте ссылку целиком, как она пришла в чат.'}</p>
            <div className="mt-4">
              <Button
                type="button"
                variant="link"
                size="md"
                onClick={() => navigate('/login')}
              >
                Перейти ко входу
              </Button>
            </div>
          </div>
        ) : done ? (
          // Привязка Telegram следующим шагом: личные напоминания приходят человеку в личку,
          // а не в общий рабочий чат, где их читают все.
          <div className="text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-success" />
            <h1 className="text-title text-fg font-semibold mt-3">Готово, вы в платформе</h1>
            <p className="text-body text-fg-subtle mt-1">
              Пароль сохранён. Дальше входите обычным способом: почта и ваш пароль.
            </p>
            <div className="mt-5 rounded-block border border-border p-4 text-left">
              <p className="text-body text-fg-muted font-medium">Подключите Telegram</p>
              <p className="text-micro text-fg-subtle mt-1 mb-3">
                Напоминания о записях и разборах будут приходить лично вам, а не в общий чат.
              </p>
              <TelegramLinkButton />
            </div>
            <div className="mt-4">
              <Button fullWidth onClick={() => navigate('/dashboard')}>
                Перейти на главную
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <h1 className="text-title font-semibold text-fg">Придумайте пароль</h1>
              {who ? (
                <p className="text-body text-fg-subtle mt-1">
                  {who.fullName}
                  {who.companyName ? `, ${who.companyName}` : ''} · {who.email}
                </p>
              ) : (
                <p className="text-body text-fg-subtle mt-1">Проверяем ссылку…</p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="activate-password">Пароль</Label>
                <Input
                  id="activate-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Минимум 6 символов"
                />
              </div>
              <div>
                <Label htmlFor="activate-confirm">Ещё раз</Label>
                <Input
                  id="activate-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Повторите пароль"
                />
              </div>
              {error && <p className="text-body text-danger" role="alert">{error}</p>}
              <Button type="submit" fullWidth disabled={busy || !who} icon={<KeyRound />}>
                {busy ? 'Сохраняем…' : 'Сохранить и войти'}
              </Button>
            </form>

            <p className="text-micro text-fg-subtle mt-5 text-center">
              Ссылка личная и одноразовая: после того как вы зададите пароль, она перестанет работать.
            </p>
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
