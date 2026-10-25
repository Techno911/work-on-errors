import client from './client';
import type { Notification } from '@/types';

export const notificationsApi = {
  getAll: () =>
    client.get<Notification[]>('/notifications'),

  getUnreadCount: () =>
    client.get<{ count: number }>('/notifications/unread-count'),

  markRead: (id: string) =>
    client.patch<Notification>(`/notifications/${id}/read`),

  markAllRead: () =>
    client.patch<{ updated: number }>('/notifications/read-all'),
};
