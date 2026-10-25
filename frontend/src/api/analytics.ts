import client from './client';
import type { ErrorFrequencyData, ErrorTrendData, ManagerStatsData, ActivityPatternsData, ReviewerStats } from '@/types';

export const analyticsApi = {
  getErrorFrequency: (companyId: string, period: string = 'all') =>
    client.get<ErrorFrequencyData>('/analytics/error-frequency', { params: { companyId, period } }),

  getErrorTrend: (companyId: string, tagId: string) =>
    client.get<ErrorTrendData>('/analytics/error-trend', { params: { companyId, tagId } }),

  getManagerStats: (companyId: string, sprintId?: string) =>
    client.get<ManagerStatsData>('/analytics/manager-stats', { params: { companyId, sprintId } }),

  getActivityPatterns: (companyId: string, managerId?: string) =>
    client.get<ActivityPatternsData>('/analytics/activity-patterns', { params: { companyId, managerId } }),

  getReviewerStats: (companyId: string, reviewerId?: string) =>
    client.get<ReviewerStats>('/analytics/reviewer-stats', { params: { companyId, reviewerId } }),

  export: (companyId: string, from?: string, to?: string) =>
    client.get<unknown>('/analytics/export', { params: { companyId, format: 'json', from, to } }),
};
