import { useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/api/auth';
import { Label } from '@/components/ui/input';
import { BrandMark, Button, Input, Card } from '@chirkov/shell';
import type { AxiosError } from 'axios';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const { token: pathToken } = useParams();
  const token = pathToken ?? params.get('token') ?? '';
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      const serverMsg = axiosError.response?.data?.message;
      setError(typeof serverMsg === 'string' && /[А-Яа-яЁё]/.test(serverMsg)
        ? serverMsg
        : 'Не удалось изменить пароль. Запросите восстановление заново.');
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

        {!token ? (
          <div className="text-center">
            <h1 className="text-title text-fg font-semibold">Ссылка неполная</h1>
            <p className="text-body text-fg-subtle mt-1">Откройте ссылку из письма целиком или запросите восстановление заново.</p>
            <div className="mt-4">
              <Button
                onClick={() => navigate('/login')}
                variant="link"
                size="md"
              >
                Вернуться ко входу
              </Button>
            </div>
          </div>
        ) : done ? (
          <div className="text-center">
            <CheckCircle2 className="w-10 h-10 text-success-fg mx-auto mb-3" />
            <h1 className="text-title text-fg font-semibold">Пароль изменён</h1>
            <p className="text-body text-fg-subtle mt-1">Теперь войдите с новым паролем.</p>
            <div className="mt-5">
              <Button onClick={() => navigate('/login')} size="md" fullWidth>
                Войти
              </Button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-title font-semibold text-fg text-center mb-1">Новый пароль</h1>
            <p className="text-body text-fg-subtle text-center mb-6">Придумайте пароль для входа в платформу.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="bg-danger-subtle border border-danger text-danger-fg text-body rounded-block px-4 py-3">
                  {error}
                </div>
              )}
              <div>
                <Label htmlFor="new-password">Новый пароль</Label>
                <Input
                  id="new-password"
                  type="password"
                  minLength={6}
                  placeholder="Не короче 6 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  autoComplete="new-password"
                />
              </div>
              <div>
                <Label htmlFor="confirm-password">Повторите пароль</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  minLength={6}
                  placeholder="Ещё раз"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>
              <Button
                type="submit"
                size="md"
                disabled={busy}
                fullWidth
                icon={busy ? <div className="animate-spin rounded-full h-4 w-4 border-2 border-on-inverse border-t-transparent" /> : <KeyRound />}
              >
                {busy ? 'Сохраняем…' : 'Сохранить пароль'}
              </Button>
            </form>
          </>
        )}
      </Card>
      </div>
    </div>
  );
}
