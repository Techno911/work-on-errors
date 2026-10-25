import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { UserCog, Plus, Copy, Check, Eye, KeyRound, Trash2 } from 'lucide-react';
import { adminApi, type TrackerInfo } from '@/api/admin';
import { useAuthStore } from '@/stores/authStore';
import { Button, Input, Badge, Card } from '@chirkov/shell';

/**
 * Управление трекерами (производственный отдел ЧиП). Видит и правит только суперадмин.
 * Трекер видит все компании и ведёт онбординг, но без опасных действий суперадмина.
 */
export function TrackersSection() {
  const [trackers, setTrackers] = useState<TrackerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [newCreds, setNewCreds] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const navigate = useNavigate();
  const startImpersonation = useAuthStore(s => s.startImpersonation);

  const load = async () => {
    try {
      const { data } = await adminApi.listTrackers();
      setTrackers(data ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!fullName.trim() || !email.trim()) {
      toast.error('Укажите имя и email');
      return;
    }
    setSaving(true);
    try {
      const { data } = await adminApi.createTracker({ fullName: fullName.trim(), email: email.trim() });
      setNewCreds({ email: data.tracker.email, password: data.tempPassword });
      setFullName(''); setEmail(''); setAdding(false);
      await load();
      toast.success('Трекер создан. Передайте ему логин и пароль');
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Не удалось создать трекера');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: TrackerInfo) => {
    setTogglingId(t.id);
    try {
      await adminApi.setTrackerActive(t.id, !t.isActive);
      await load();
    } catch {
      toast.error('Не удалось изменить статус');
    } finally {
      setTogglingId(null);
    }
  };

  // «Режим бога»: суперадмин входит под трекером проверить функционал (токен на 15 минут, F5 вернёт).
  const impersonate = async (t: TrackerInfo) => {
    setActingId(t.id);
    try {
      const { data } = await adminApi.impersonate(t.id);
      startImpersonation(data.accessToken, data.user);
      navigate('/dashboard');
    } catch {
      toast.error('Не удалось войти под трекером', { duration: Infinity });
    } finally {
      setActingId(null);
    }
  };

  // Сброс пароля трекера (если суперадмин не помнит его) — выдаёт новый временный пароль.
  const resetPass = async (t: TrackerInfo) => {
    setActingId(t.id);
    try {
      const { data } = await adminApi.resetUserPassword(t.id);
      setNewCreds({ email: t.email, password: data.newPassword });
      toast.success('Пароль трекера сброшен. Передайте новый доступ');
    } catch {
      toast.error('Не удалось сбросить пароль', { duration: Infinity });
    } finally {
      setActingId(null);
    }
  };

  // Полное удаление трекера (необратимо) — освобождает email. Подтверждение инлайн в строке.
  const remove = async (t: TrackerInfo) => {
    setDeletingId(t.id);
    try {
      await adminApi.deleteTracker(t.id);
      setConfirmDeleteId(null);
      await load();
      toast.success('Трекер удалён, email освобождён');
    } catch {
      toast.error('Не удалось удалить трекера', { duration: Infinity });
    } finally {
      setDeletingId(null);
    }
  };

  const copyCreds = async () => {
    if (!newCreds) return;
    const text = `Платформа: ${window.location.origin}\nЛогин: ${newCreds.email}\nПароль: ${newCreds.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
      toast.success('Доступы скопированы');
    } catch { toast.error('Не удалось скопировать'); }
  };

  return (
    <Card padding="md">
      <div className="flex flex-col items-stretch gap-2 mb-1 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
        <div className="flex items-center gap-2">
          <UserCog className="w-4 h-4 text-accent" />
          <h2 className="text-body-lg font-semibold text-fg">Команда трекеров</h2>
        </div>
        {!adding && (
          <Button
            type="button"
            onClick={() => { setAdding(true); setNewCreds(null); }}
            variant="secondary"
            size="md"
            icon={<Plus />}
          >
            Добавить трекера
          </Button>
        )}
      </div>
      <p className="text-micro text-fg-subtle mb-4">
        Трекер ведёт онбординг всех компаний, но без опасных действий: входа «Глазами», удаления людей и управления трекерами.
      </p>

      {/* Доступы только что созданного трекера */}
      {newCreds && (
        <div className="mb-4 rounded-block border border-accent-muted bg-accent-subtle p-3 space-y-2">
          <p className="text-body font-medium text-accent-fg-deep">Трекер создан. Передайте доступы лично:</p>
          <div className="text-body text-fg-muted font-mono">
            <div>Логин: {newCreds.email}</div>
            <div>Пароль: {newCreds.password}</div>
          </div>
          <Button
            type="button"
            onClick={copyCreds}
            icon={copied ? <Check /> : <Copy />}
          >
            {copied ? 'Скопировано' : 'Скопировать доступы'}
          </Button>
        </div>
      )}

      {/* Форма добавления */}
      {adding && (
        <div className="mb-4 rounded-block border border-border p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="text" placeholder="Имя" value={fullName} autoFocus
              onChange={e => setFullName(e.target.value)}
            />
            <Input
              type="email" placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={create} disabled={saving}>
              {saving ? 'Создаём…' : 'Создать'}
            </Button>
            <Button type="button" variant="ghost" size="md" onClick={() => { setAdding(false); setFullName(''); setEmail(''); }}>
              Отмена
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-body text-fg-subtle py-2">Загрузка…</p>
      ) : trackers.length === 0 ? (
        <p className="text-body text-fg-subtle py-2">Трекеров пока нет. Добавьте первого.</p>
      ) : (
        <div className="space-y-2">
          {trackers.map(t => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-card border border-border">
              <div className="flex-1 min-w-0">
                <div className="text-body font-medium text-fg truncate">{t.fullName}</div>
                <div className="text-micro text-fg-subtle truncate">{t.email}</div>
              </div>
              {confirmDeleteId === t.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-micro text-danger-fg">Удалить насовсем? Email освободится.</span>
                  <Button variant="danger" size="sm"
                    onClick={() => remove(t)}
                    disabled={deletingId === t.id}
                  >
                    {deletingId === t.id ? 'Удаляем…' : 'Удалить'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    disabled={deletingId === t.id}
                    variant="ghost"
                    size="sm"
                  >
                    Отмена
                  </Button>
                </div>
              ) : (
                <>
                  <Badge tone={t.isActive ? 'success' : 'neutral'}>
                    {t.isActive ? 'Активен' : 'Отключён'}
                  </Badge>
                  <Button
                    type="button"
                    onClick={() => impersonate(t)}
                    disabled={actingId === t.id}
                    title="Войти под трекером"
                    aria-label="Войти под трекером"
                    variant="ghost"
                    size="sm"
                    icon={<Eye />}
                  />
                  <Button
                    type="button"
                    onClick={() => resetPass(t)}
                    disabled={actingId === t.id}
                    title="Сбросить пароль трекера"
                    aria-label="Сбросить пароль трекера"
                    variant="ghost"
                    size="sm"
                    icon={<KeyRound />}
                  />
                  <Button
                    type="button"
                    onClick={() => toggle(t)}
                    disabled={togglingId === t.id}
                    variant="ghost"
                    size="sm"
                  >
                    {t.isActive ? 'Отключить' : 'Включить'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => setConfirmDeleteId(t.id)}
                    title="Удалить трекера полностью"
                    aria-label="Удалить трекера полностью"
                    variant="ghost"
                    size="sm"
                    icon={<Trash2 />}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
