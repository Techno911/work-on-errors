import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { toast } from 'sonner';
import { notificationsApi } from '@/api/notifications';
import { useNotificationStore } from '@/stores/notificationStore';
import { useAuthStore } from '@/stores/authStore';
import { Button, Card, IconButton, ListRow } from '@chirkov/shell';
import type { NotificationType } from '@/types';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { notifications, unreadCount, setNotifications, markRead, markAllRead } =
    useNotificationStore();

  useEffect(() => {
    if (!isAuthenticated) return;
    const load = async () => {
      try {
        const { data } = await notificationsApi.getAll();
        setNotifications(data);
      } catch {
        // ignore
      }
    };
    load();
    const interval = setInterval(load, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, [isAuthenticated, setNotifications]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const handleNotificationClick = async (notification: (typeof notifications)[0]) => {
    if (!notification.isRead) {
      try {
        await notificationsApi.markRead(notification.id);
        markRead(notification.id);
      } catch {
        // ignore
      }
    }
    setOpen(false);
    // Навигация: используем linkUrl если есть, иначе — fallback на Sprint Board
    navigate(notification.linkUrl ?? '/sprint');
  };

  const handleMarkAllRead = async () => {
    // Локальное состояние обновляется ТОЛЬКО после подтверждения сервера — чтобы
    // при сетевой/500-ошибке пользователь не думал, что прочитал всё, если сервер это не сохранил.
    try {
      await notificationsApi.markAllRead();
      markAllRead();
    } catch {
      toast.error('Не удалось отметить уведомления прочитанными. Попробуйте ещё раз.');
    }
  };

  // Record<NotificationType,...> (не Record<string,...>) — tsc теперь сам ловит новый тип
  // уведомления без иконки вместо молчаливого fallback на 🔔 (было с crm_error).
  const typeIcons: Record<NotificationType, string> = {
    entry_submitted: '📋',
    entry_reviewed: '✅',
    entry_needs_revision: '⚠️',
    sprint_started: '🚀',
    sprint_deadline: '⏰',
    invite_accepted: '👋',
    crm_error: '🔴',
    help_requested: '🆘',
    rop_bonus: '💰',
    playbook_candidate: '📘',
    launch: '🏁',
    stt_error: '🎙',
    crm_connected: '🔌',
    attestation_assigned: '📝',
    attestation_ready_to_review: '🎓',
    attestation_result: '🏅',
    access_not_used: '🔑',
    team_changed: '👥',
  };

  const formatTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'только что';
    if (mins < 60) return `${mins} мин назад`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ч назад`;
    return `${Math.floor(hours / 24)} дн назад`;
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <IconButton
        onClick={() => setOpen((v) => !v)}
        aria-label="Уведомления"
        aria-expanded={open}
        count={unreadCount}
      >
        <Bell size={20} />
      </IconButton>

      {open && (
        <Card radius="block" padding="none" className="absolute right-0 top-full mt-2 w-80 shadow-raised z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="font-heading font-semibold text-body text-fg">
              Уведомления
            </span>
            {unreadCount > 0 && (
              <Button
                type="button"
                onClick={handleMarkAllRead}
                variant="link"
                size="sm"
              >
                Прочитать все
              </Button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-fg-subtle">
                <Bell size={32} className="mb-2 opacity-40" />
                <p className="text-body">Нет уведомлений</p>
              </div>
            ) : (() => {
              const unread = notifications.filter(n => !n.isRead);
              const read = notifications.filter(n => n.isRead);
              const renderItem = (n: (typeof notifications)[0]) => (
                <ListRow
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  tone={n.isRead ? 'plain' : 'accent-soft'}
                  icon={<span className="text-title">{typeIcons[n.type] ?? '🔔'}</span>}
                >
                  <span className="flex items-start gap-3 w-full text-left">
                    <span className="flex-1 min-w-0">
                      <span className="block text-body font-medium text-fg break-words">{n.title}</span>
                      <span className="block text-micro text-fg-subtle mt-0.5 line-clamp-2">{n.message}</span>
                      <span className="block text-micro text-fg-subtle mt-1">{formatTime(n.createdAt)}</span>
                    </span>
                    {!n.isRead && (
                      <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-1" aria-label="Не прочитано" role="img" />
                    )}
                  </span>
                </ListRow>
              );
              return (
                <>
                  {unread.length > 0 && (
                    <>
                      <div className="px-4 py-1.5 text-micro font-semibold text-fg-subtle uppercase tracking-overline bg-canvas border-b border-surface-sunken">
                        Новые
                      </div>
                      <div className="flex flex-col gap-1 p-1">{unread.map(renderItem)}</div>
                    </>
                  )}
                  {read.length > 0 && (
                    <>
                      {unread.length > 0 && (
                        <div className="px-4 py-1.5 text-micro font-semibold text-fg-subtle uppercase tracking-overline bg-canvas border-b border-surface-sunken">
                          Прочитанные
                        </div>
                      )}
                      <div className="flex flex-col gap-1 p-1">{read.map(renderItem)}</div>
                    </>
                  )}
                </>
              );
            })()}
          </div>
        </Card>
      )}
    </div>
  );
}
