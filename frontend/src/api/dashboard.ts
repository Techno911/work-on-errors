import client from './client';
import type { Sprint, CompanySettings } from '@/types';

export interface ManagerDashboardData {
  sprint: Sprint | null;
  progress: {
    calls: { count: number; thresholdGood: number; thresholdGreat: number; zone: 'below' | 'good' | 'great' } | null;
    chats: { count: number; thresholdGood: number; thresholdGreat: number; zone: 'below' | 'good' | 'great' } | null;
    overallZone: 'below' | 'good' | 'great';
    isRampUp?: boolean;
    rampUpFactor?: number;
    selfReviewCompleted: number;
    reviewedByRop: number;
  } | null;
  recentReviewed: {
    id: string;
    type: 'call' | 'chat';
    entryNumber: number;
    reviewText: string | null;
    status: string;
    updatedAt: string;
  }[];
  totalEntriesAllTime?: number;
  // Первые шаги: all-time факты, не зависящие от текущей недели и спринта.
  firstSteps?: { hasEntries: boolean; hasSelfReview: boolean };
  settings: CompanySettings;
}

export interface ReviewerDashboardData {
  sprint: Sprint | null;
  pendingCount: number;
  // Первые шаги: есть ли хотя бы одно ревью за всё время.
  firstSteps?: { hasReviews: boolean };
  teamMembers: {
    id: string;
    fullName: string;
    color: string | null;
    callCount: number;
    chatCount: number;
    pendingCount: number;
    reviewedCount: number;
    entriesCount: number;
  }[];
  settings: CompanySettings;
}

// Экран состояния собственника: идёт работа или нет, кто её не делает, что от него требуется.
export interface OwnerStateData {
  companyName: string;
  hasWorkChat: boolean;
  work: { state: 'not_started' | 'ramping' | 'running' | 'lagging' | 'silent'; label: string; detail: string; days: number };
  paused: { reason: string | null; expectedReturnAt: string | null } | null;
  people: Array<{
    id: string;
    fullName: string;
    roleLabel: string;
    state: 'never_logged' | 'no_work' | 'ok';
    note: string;
    neverLoggedIn: boolean;
  }>;
  actions: Array<{ key: string; label: string; hint: string }>;
  lastEntryAt: string | null;
  submittedTotal: number;
  reviewedTotal: number;
}

export const dashboardApi = {
  getManagerData: (companyId: string, managerId: string) =>
    client.get<ManagerDashboardData>('/dashboard/manager', { params: { companyId, managerId } }),
  getReviewerData: (companyId: string) =>
    client.get<ReviewerDashboardData>('/dashboard/reviewer', { params: { companyId } }),
  getOwnerState: (companyId: string) =>
    client.get<OwnerStateData>('/dashboard/owner-state', { params: { companyId } }),
  resendAccess: (companyId: string) =>
    client.post<{ sent: number; failed: string[] }>('/dashboard/owner-state/resend-access', {}, { params: { companyId } }),
  callTracker: (companyId: string) =>
    client.post<{ requested: boolean }>('/dashboard/owner-state/call-tracker', {}, { params: { companyId } }),
};
