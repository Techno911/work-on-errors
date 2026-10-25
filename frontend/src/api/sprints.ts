import client from './client';
import type { Sprint, SprintProgress, TeamProgress } from '@/types';

export const sprintsApi = {
  getCurrent: (companyId: string) =>
    client.get<Sprint>(`/sprints/current`, { params: { companyId } }),
  getById: (id: string) =>
    client.get<Sprint>(`/sprints/${id}`),
  getList: (companyId: string) =>
    client.get<Sprint[]>(`/sprints`, { params: { companyId } }),
  getHistory: (companyId: string, page = 1) =>
    client.get<{ sprints: Sprint[]; total: number; hasMore: boolean }>(
      `/sprints/history`,
      { params: { companyId, page } },
    ),
  updateStatus: (id: string, status: string) =>
    client.patch<Sprint>(`/sprints/${id}`, { status }),
  getProgress: (sprintId: string, managerId: string) =>
    client.get<SprintProgress>(`/sprints/${sprintId}/progress`, { params: { managerId } }),
  getTeamProgress: (sprintId: string) =>
    client.get<TeamProgress>(`/sprints/${sprintId}/team-progress`),
};
