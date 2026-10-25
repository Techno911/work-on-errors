import client from './client';
import type { AuthResponse, User } from '@/types';

export const authApi = {
  login: (email: string, password: string, rememberMe = false) =>
    client.post<AuthResponse>('/auth/login', { email, password, rememberMe }),

  register: (email: string, password: string, fullName: string, opts?: { inviteCode?: string; offerToken?: string }) =>
    client.post<AuthResponse>('/auth/register', {
      email,
      password,
      fullName,
      inviteCode: opts?.inviteCode,
      offerToken: opts?.offerToken,
    }),

  forgotPassword: (email: string) => client.post<{ ok: boolean }>('/auth/forgot-password', { email }),

  resetPassword: (token: string, newPassword: string) =>
    client.post<{ ok: boolean }>('/auth/reset-password', { token, newPassword }),

  refresh: () => client.post<{ accessToken: string }>('/auth/refresh'),

  logout: () => client.post('/auth/logout'),

  me: () => client.get<{ user: User }>('/auth/me'),

  // Именная одноразовая ссылка первого входа: кто за ней стоит и жива ли она.
  describeActivation: (token: string) =>
    client.get<{ fullName: string; email: string; companyName: string | null }>(`/auth/activation/${token}`),

  // Человек задаёт пароль по своей ссылке и сразу входит.
  activate: (token: string, password: string) =>
    client.post<AuthResponse>(`/auth/activation/${token}`, { password }),
};
