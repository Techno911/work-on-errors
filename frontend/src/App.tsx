import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, lazy, Suspense } from 'react';
import axios from 'axios';
import { Toaster } from 'sonner';
import { useAuthStore } from '@/stores/authStore';
import { API_BASE_URL } from '@/api/client';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { CrmSetupPage } from '@/pages/CrmSetupPage';
import { AppLayout } from '@/components/layout/AppLayout';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LoginPage } from '@/pages/LoginPage';
import type { User } from '@/types';

// Lazy-loaded pages — each becomes its own JS chunk
const DashboardPage = lazy(() => import('@/pages/DashboardPage').then(m => ({ default: m.DashboardPage })));
const SprintBoardPage = lazy(() => import('@/pages/SprintBoardPage').then(m => ({ default: m.SprintBoardPage })));
const AnalyticsPage = lazy(() => import('@/pages/AnalyticsPage').then(m => ({ default: m.AnalyticsPage })));
const SettingsPage = lazy(() => import('@/pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const InvitePage = lazy(() => import('@/pages/InvitePage').then(m => ({ default: m.InvitePage })));
const OfferPage = lazy(() => import('@/pages/OfferPage').then(m => ({ default: m.OfferPage })));
const RopBonusOfferPage = lazy(() => import('@/pages/RopBonusOfferPage').then(m => ({ default: m.RopBonusOfferPage })));
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const ActivatePage = lazy(() => import('@/pages/ActivatePage').then(m => ({ default: m.ActivatePage })));
const PdnConsentPage = lazy(() => import('@/pages/PdnConsentPage').then(m => ({ default: m.PdnConsentPage })));
const CompanyDetailPage = lazy(() => import('@/pages/admin/CompanyDetailPage').then(m => ({ default: m.CompanyDetailPage })));
const ManualPage = lazy(() => import('@/pages/ManualPage').then(m => ({ default: m.ManualPage })));
const PlaybookPage = lazy(() => import('@/pages/PlaybookPage').then(m => ({ default: m.PlaybookPage })));
const AttestationPage = lazy(() => import('@/pages/AttestationPage').then(m => ({ default: m.AttestationPage })));
const AttestationTakePage = lazy(() => import('@/pages/AttestationTakePage').then(m => ({ default: m.AttestationTakePage })));
const AttestationReviewPage = lazy(() => import('@/pages/AttestationReviewPage').then(m => ({ default: m.AttestationReviewPage })));
const AttestationResultPage = lazy(() => import('@/pages/AttestationResultPage').then(m => ({ default: m.AttestationResultPage })));
const DsStandPage = lazy(() => import('@/pages/DsStandPage').then(m => ({ default: m.DsStandPage })));

// Витрина токенов (см. useEffect ниже и ds/стенд.sh) — не реальный человек.
const DS_STAND_USER: User = {
  id: 'ds-stand-user', email: 'demo@example.invalid', fullName: 'Демо Пользователь',
  role: 'reviewer', companyId: 'ds-stand-company', color: null, avatarUrl: null,
  isActive: true, onboardingSeenAt: new Date().toISOString(), releasesSeenVersion: '99.99.99', firstStepsHiddenAt: null,
  createdAt: new Date().toISOString(),
  company: { id: 'ds-stand-company', name: 'Демо · Стоматология «Улыбка»', paymentHold: false },
  pdnConsentAcceptedAt: new Date().toISOString(), lnaAcknowledgedAt: new Date().toISOString(),
};

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-accent-muted border-t-accent rounded-full animate-spin" />
    </div>
  );
}

function App() {
  const login = useAuthStore((s) => s.login);
  const logout = useAuthStore((s) => s.logout);

  // Try to refresh token on app load.
  // Uses plain axios (NOT the client with interceptors) to avoid triggering
  // the 401 interceptor on the refresh call itself — which caused an infinite loop.
  useEffect(() => {
    // Витрина токенов (VITE_DS_STAND=1, ds/стенд.sh): без бэкенда и без учётки —
    // обычный refresh упал бы сетевой ошибкой и увёл на /login, поэтому сеанс
    // проставляется напрямую демо-пользователем.
    if (import.meta.env.VITE_DS_STAND === '1') {
      login('ds-stand-token', DS_STAND_USER);
      return;
    }
    const initAuth = async () => {
      try {
        const { data: refreshData } = await axios.post<{ accessToken: string }>(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );

        const { data: meData } = await axios.get<{ user: User }>(
          `${API_BASE_URL}/auth/me`,
          { headers: { Authorization: `Bearer ${refreshData.accessToken}` } },
        );

        login(refreshData.accessToken, meData.user);
      } catch {
        logout();
      }
    };
    initAuth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <BrowserRouter>
      <Toaster richColors position="top-right" closeButton duration={8000} />
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/invite/:code" element={<InvitePage />} />
            <Route path="/offer/:token" element={<OfferPage />} />
            <Route path="/rop-bonus-offer/:token" element={<RopBonusOfferPage />} />
            <Route path="/crm-setup/:token" element={<CrmSetupPage />} />
            {/* Именная ссылка первого входа: человек задаёт пароль сам, пароли в чат не уходят. */}
            <Route path="/activate/:token" element={<ActivatePage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/pdn-consent" element={<PdnConsentPage />} />
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/sprint" element={<SprintBoardPage />} />
                <Route path="/sprint/:sprintId" element={<SprintBoardPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/playbook" element={<PlaybookPage />} />
                <Route path="/attestation" element={<AttestationPage />} />
                <Route path="/attestation/take/:attemptId" element={<AttestationTakePage />} />
                <Route path="/attestation/review/:attemptId" element={<AttestationReviewPage />} />
                <Route path="/attestation/result/:attemptId" element={<AttestationResultPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/manual" element={<ManualPage />} />
                <Route path="/admin/company/:companyId" element={<CompanyDetailPage />} />
                <Route path="/ds-stand" element={<DsStandPage />} />
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
