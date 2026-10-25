import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { usersApi } from '@/api/users';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input } from '@chirkov/shell';

/**
 * Смена собственного пароля + честная подсказка на случай, если пароль забыт:
 * владелец и РОП пишут в поддержку «ЧиП», менеджер обращается к своему РОПу.
 */
export function ChangePasswordCard() {
  const user = useAuthStore(s => s.user);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);

  const forgotHint = user?.role === 'superadmin'
    ? 'Пароль любого сотрудника можно сбросить в карточке его компании (кнопка «Пароль»).'
    : user?.role === 'manager'
      ? 'Забыли пароль? Обратитесь к вашему РОПу.'
      : 'Забыли пароль? Напишите в поддержку «ЧиП», обновим в течение рабочего дня.';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 6) {
      toast.error('Новый пароль должен быть не короче 6 символов', { duration: Infinity });
      return;
    }
    setSaving(true);
    try {
      await usersApi.changePassword(current, next);
      toast.success('Пароль изменён');
      setOpen(false);
      setCurrent('');
      setNext('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(typeof msg === 'string' && /парол/i.test(msg) ? msg : 'Не удалось изменить пароль. Проверьте текущий пароль и попробуйте ещё раз.', { duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-surface-sunken flex items-center justify-center flex-shrink-0 mt-0.5">
        <KeyRound className="w-4 h-4 text-fg-subtle" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-body font-medium text-fg">Ваш пароль</p>
          {!open && (
            <Button
              type="button"
              onClick={() => setOpen(true)}
              variant="link"
              size="sm"
            >
              Сменить пароль
            </Button>
          )}
        </div>
        {open ? (
          <form onSubmit={handleSubmit} className="mt-2 space-y-2 max-w-sm">
            <Input
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              placeholder="Текущий пароль"
              autoComplete="current-password"
              required
            />
            <Input
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              placeholder="Новый пароль (от 6 символов)"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <div className="flex gap-2">
              <Button
                type="submit"
                disabled={saving}
                size="sm"
              >
                {saving ? 'Сохраняем…' : 'Сохранить пароль'}
              </Button>
              <Button
                type="button"
                onClick={() => { setOpen(false); setCurrent(''); setNext(''); }}
                variant="ghost"
                size="sm"
              >
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <p className="text-micro text-fg-subtle mt-0.5">
            Пароли хранятся в зашифрованном виде, посмотреть их нельзя. {forgotHint}
          </p>
        )}
      </div>
    </div>
  );
}
