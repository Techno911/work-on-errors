import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Eye, LogOut } from 'lucide-react';
import { AppShell, Button } from '@chirkov/shell';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { OfflineBanner } from '@/components/OfflineBanner';
import { WhatsNewGate, openWhatsNew } from '@/components/onboarding/WhatsNewModal';
import { navItems } from '@/config/nav';
import { PageTitleContext } from './PageTitle';
import { PLATFORM } from '@/config/platform';

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  tracker: 'Трекер',
  owner: 'Владелец',
  reviewer: 'РОП',
  manager: 'Менеджер',
};

// «Что нового» доступно ролям, для которых есть анонсы (было в Sidebar, канон §3).
const WHATS_NEW_ROLES = ['manager', 'reviewer', 'owner'];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const impersonator = useAuthStore(s => s.impersonator);
  const user = useAuthStore(s => s.user);
  const logoutStore = useAuthStore(s => s.logout);
  const stopImpersonation = useAuthStore(s => s.stopImpersonation);
  const [pageTitle, setPageTitle] = useState<string | undefined>();

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore errors on logout
    }
    logoutStore();
    navigate('/login');
  };

  if (!user) return null;

  return (
    <PageTitleContext.Provider value={setPageTitle}>
      <OfflineBanner />
      {/* Анонс обновлений: живёт в оболочке, поэтому догоняет человека на любой странице */}
      <WhatsNewGate />
      <AppShell
        platformKey="ro"
        product={PLATFORM.product}
        version={__APP_VERSION__}
        navItems={navItems}
        role={user.role}
        currentPath={location.pathname}
        user={{ name: user.fullName, role: roleLabels[user.role] ?? user.role, avatarUrl: user.avatarUrl ?? undefined }}
        userActions={
          WHATS_NEW_ROLES.includes(user.role)
            ? [{ label: 'Что нового', onClick: openWhatsNew }]
            : undefined
        }
        onNavigate={navigate}
        onLogout={handleLogout}
        actions={<NotificationBell />}
        title={pageTitle}
      >
        {/* Баннер режима «глазами сотрудника» — у оболочки нет отдельного слота
            над шапкой на всю ширину, поэтому баннер идёт первым в содержимом. */}
        {impersonator && (
          <div className="flex items-center justify-between gap-3 px-4 py-2 mb-4 rounded-block text-body bg-accent text-on-accent">
            <span className="flex items-center gap-2 min-w-0">
              <Eye className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">Вы смотрите платформу глазами: <b>{user.fullName}</b> ({user.email})</span>
            </span>
            <div className="flex-shrink-0">
              <Button
                variant="secondary"
                size="sm"
                icon={<LogOut />}
                onClick={() => { stopImpersonation(); navigate('/dashboard'); }}
              >
                Вернуться в суперадмина
              </Button>
            </div>
          </div>
        )}
        <Outlet />
      </AppShell>
    </PageTitleContext.Provider>
  );
}
