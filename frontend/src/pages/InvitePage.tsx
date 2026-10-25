import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { UserPlus, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { invitesApi } from '@/api/invites';
import { authApi } from '@/api/auth';
import type { Invite } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import type { AxiosError } from 'axios';
import { Button, Input, Card } from '@chirkov/shell';

const roleLabels: Record<string, string> = {
  manager: 'Менеджер',
  reviewer: 'Руководитель отдела продаж',
  owner: 'Владелец',
};

export function InvitePage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const { isAuthenticated, login, setUser } = useAuthStore();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Registration form state (for unauthenticated new users)
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [registering, setRegistering] = useState(false);

  useEffect(() => {
    if (!code) return;
    invitesApi
      .getByCode(code)
      .then(({ data }) => {
        setInvite(data);
        // Pre-fill name if owner specified it in the invite
        if (data.fullName) setFullName(data.fullName);
      })
      .catch(() => setError('Приглашение не найдено или недействительно'))
      .finally(() => setLoading(false));
  }, [code]);

  // Accept invite for already-authenticated users
  const handleAccept = async () => {
    if (!code) return;
    setAccepting(true);
    try {
      await invitesApi.accept(code);
      // Refresh user to get updated companyId and role from token
      const { data } = await authApi.me();
      setUser(data.user);
      toast.success('Вы успешно присоединились к компании!');
      navigate('/dashboard');
    } catch {
      toast.error('Не удалось принять приглашение', { duration: Infinity });
    } finally {
      setAccepting(false);
    }
  };

  // Register NEW account and accept invite in one flow
  const handleRegisterAndAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegisterError('');

    if (!fullName.trim()) {
      setRegisterError('Введите ваше имя');
      return;
    }
    if (password.length < 6) {
      setRegisterError('Пароль должен содержать не менее 6 символов');
      return;
    }
    if (password !== confirmPassword) {
      setRegisterError('Пароли не совпадают');
      return;
    }
    if (!invite || !code) return;

    setRegistering(true);
    try {
      // 1. Register new account with invite email
      const { data: authData } = await authApi.register(
        invite.email,
        password,
        fullName.trim(),
        { inviteCode: code },
      );
      // 2. Store auth tokens in memory
      login(authData.accessToken, authData.user);

      // 3. Accept the invite (now authenticated)
      await invitesApi.accept(code);

      // 4. Refresh user to get companyId and role
      const { data: meData } = await authApi.me();
      setUser(meData.user);

      toast.success('Аккаунт создан. Добро пожаловать');
      navigate('/dashboard');
    } catch (err) {
      const axiosError = err as AxiosError<{ message?: string }>;
      const msg = axiosError.response?.data?.message ?? '';
      if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('уже существует') || msg.toLowerCase().includes('уже зарегистрирован')) {
        setRegisterError('Пользователь с таким email уже зарегистрирован. Войдите в аккаунт.');
      } else {
        setRegisterError('Не удалось создать аккаунт. Попробуйте ещё раз.');
      }
    } finally {
      setRegistering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center py-8">
        <div className="max-w-md w-full mx-4">
          <Card padding="lg" elevation="raised" className="animate-pulse">
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-border" />
            <div className="h-6 bg-border rounded-chip w-40" />
            <div className="h-4 bg-surface-sunken rounded-chip w-56" />
          </div>
          <div className="bg-canvas rounded-block p-4 mb-6 space-y-3">
            <div className="h-4 bg-border rounded-chip w-full" />
            <div className="h-4 bg-border rounded-chip w-3/4" />
            <div className="h-4 bg-border rounded-chip w-2/3" />
          </div>
          <div className="h-12 bg-border rounded-block w-full" />
        </Card>
        </div>
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <Card padding="lg" elevation="raised" className="text-center">
          <div className="flex justify-center mb-4">
            <AlertCircle className="w-10 h-10 text-fg-disabled" strokeWidth={1.5} />
          </div>
          <h1 className="font-heading text-title font-bold text-fg mb-2">
            Приглашение недействительно
          </h1>
          <p className="text-body text-fg-subtle mb-6">{error ?? 'Ссылка устарела или была уже использована'}</p>
          <Link
            to="/login"
            className="inline-block bg-accent text-on-inverse px-6 py-2 rounded-control font-medium hover:bg-accent transition-colors"
          >
            На главную
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
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex justify-center mb-3">
            <UserPlus className="w-10 h-10 text-accent" strokeWidth={1.5} />
          </div>
          <h1 className="font-heading text-section font-bold text-fg mb-2">
            Вас приглашают
          </h1>
          <p className="text-body text-fg-subtle">
            {invite.invitedBy?.fullName ?? 'Администратор'} приглашает вас в компанию
          </p>
        </div>

        {/* Invite details */}
        <div className="bg-accent-subtle border border-accent-muted rounded-block p-4 mb-6 space-y-2">
          <div className="flex justify-between text-body">
            <span className="text-fg-muted">Компания</span>
            <span className="font-medium text-fg">{invite.company?.name ?? '–'}</span>
          </div>
          <div className="flex justify-between text-body">
            <span className="text-fg-muted">Роль</span>
            <span className="font-medium text-fg">
              {roleLabels[invite.role] ?? invite.role}
            </span>
          </div>
          <div className="flex justify-between text-body">
            <span className="text-fg-muted">Email</span>
            <span className="font-medium text-fg">{invite.email}</span>
          </div>
          {invite.expiresAt && (
            <div className="flex justify-between text-body">
              <span className="text-fg-muted">Действует до</span>
              <span className="font-medium text-fg">
                {new Date(invite.expiresAt).toLocaleDateString('ru-RU')}
              </span>
            </div>
          )}
        </div>

        {/* Status: already used or expired */}
        {invite.status !== 'pending' ? (
          <div className="flex items-center justify-center gap-1.5 text-fg-subtle text-body py-2">
            {invite.status === 'accepted' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-success" />
                Приглашение уже принято
              </>
            ) : (
              <>
                <Clock className="w-4 h-4" />
                Приглашение истекло
              </>
            )}
          </div>

        ) : isAuthenticated ? (
          /* Already logged in → just accept the invite */
          <Button
            type="button"
            onClick={handleAccept}
            disabled={accepting}
            fullWidth
          >
            {accepting ? 'Подключаем вас к команде…' : 'Принять приглашение'}
          </Button>

        ) : (
          /* Not logged in → registration form */
          <form onSubmit={handleRegisterAndAccept} className="space-y-4">
            <p className="text-body font-semibold text-fg">
              Создайте аккаунт, чтобы присоединиться к команде
            </p>

            {/* Full name */}
            <div>
              <label className="block text-body font-medium text-fg mb-1">
                Ваше полное имя <span className="text-accent">*</span>
              </label>
              <Input
                type="text"
                placeholder="Иван Иванов"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                required
                autoFocus={!invite.fullName}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-body font-medium text-fg mb-1">
                Придумайте пароль <span className="text-accent">*</span>
              </label>
              <Input
                  type="password"
                  placeholder="Минимум 6 символов"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
            </div>

            {/* Confirm password */}
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

            {registerError && (
              <div className="bg-danger-subtle border border-danger-border rounded-card px-3 py-2 text-body text-danger-fg">
                {registerError}
              </div>
            )}

            <Button
              type="submit"
              disabled={registering}
              fullWidth
            >
              {registering ? 'Создание аккаунта...' : 'Создать аккаунт и войти'}
            </Button>

            <p className="text-micro text-center text-fg-subtle">
              Уже есть аккаунт?{' '}
              <Link
                to={`/login?redirect=/invite/${code}`}
                className="text-accent hover:underline"
              >
                Войти
              </Link>
            </p>
          </form>
        )}
      </Card>
      </div>
    </div>
  );
}
