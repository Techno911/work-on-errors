import { create } from 'zustand';
import type { User } from '@/types';

interface AuthState {
  accessToken: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  // «Посмотреть глазами»: бэкап сессии суперадмина на время имперсонации.
  // Живёт только в памяти — F5 возвращает суперадмина (refresh-cookie не трогаем).
  impersonator: { accessToken: string; user: User } | null;
  // Эпоха сессии: растёт при login/logout/имперсонации и при фактической смене
  // контекста пользователя (id/роль/компания) через setUser. НЕ меняется при
  // ротации accessToken обычным refresh — иначе отложенный ответ считал бы
  // сессию чужой и терял авторитетный результат (гонка первых шагов, приёмка №1).
  sessionVersion: number;
  setAccessToken: (token: string) => void;
  setUser: (user: User) => void;
  setLoading: (loading: boolean) => void;
  login: (token: string, user: User) => void;
  logout: () => void;
  startImpersonation: (token: string, user: User) => void;
  stopImpersonation: () => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  impersonator: null,
  sessionVersion: 0,
  setAccessToken: (token) => set({ accessToken: token, isAuthenticated: true }),
  // setUser меняет эпоху только при фактической смене контекста, не при обновлении
  // прочих полей того же человека (имя, аватар, предпочтения).
  setUser: (user) => set((s) => {
    const u = s.user;
    const contextChanged = !u || u.id !== user.id || u.role !== user.role || u.companyId !== user.companyId;
    return contextChanged ? { user, sessionVersion: s.sessionVersion + 1 } : { user };
  }),
  setLoading: (isLoading) => set({ isLoading }),
  login: (accessToken, user) =>
    set((s) => ({ accessToken, user, isAuthenticated: true, isLoading: false, impersonator: null, sessionVersion: s.sessionVersion + 1 })),
  logout: () =>
    set((s) => ({ accessToken: null, user: null, isAuthenticated: false, isLoading: false, impersonator: null, sessionVersion: s.sessionVersion + 1 })),
  startImpersonation: (token, user) => {
    const { accessToken, user: adminUser } = get();
    if (!accessToken || !adminUser) return;
    set((s) => ({
      impersonator: { accessToken, user: adminUser },
      accessToken: token,
      user,
      sessionVersion: s.sessionVersion + 1,
    }));
  },
  stopImpersonation: () => {
    const backup = get().impersonator;
    if (!backup) return;
    set((s) => ({ accessToken: backup.accessToken, user: backup.user, impersonator: null, sessionVersion: s.sessionVersion + 1 }));
  },
}));
