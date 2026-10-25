import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '@/stores/authStore';

interface FailedRequest {
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}

let isRefreshing = false;
let failedQueue: FailedRequest[] = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (token) {
      prom.resolve(token);
    } else {
      prom.reject(error);
    }
  });
  failedQueue = [];
};

// Ensure baseURL always ends with /api (guard against docker-compose passing URL without /api)
const rawApiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000/api';
export const API_BASE_URL = rawApiUrl.endsWith('/api') ? rawApiUrl : `${rawApiUrl}/api`;

const client = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach Bearer token
client.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor: handle 401 with token refresh
client.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Only intercept 401 errors on non-retry requests
    if (error.response?.status === 401 && !originalRequest._retry) {
      // BUG GUARD: если сам запрос /auth/refresh вернул 401 —
      // НЕ пытаемся рефрешить снова (это породило бы бесконечный цикл).
      // Просто сбрасываем стор и отклоняем — React Router сам редиректит на /login.
      const isRefreshEndpoint = originalRequest.url?.includes('/auth/refresh');
      if (isRefreshEndpoint) {
        useAuthStore.getState().logout();
        return Promise.reject(error);
      }

      // Если уже идёт рефреш — ставим запрос в очередь
      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return client(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Используем plain axios (не client) чтобы не попасть в этот interceptor снова
        const { data } = await axios.post<{ accessToken: string }>(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        );

        const newToken = data.accessToken;
        useAuthStore.getState().setAccessToken(newToken);
        processQueue(null, newToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }
        return client(originalRequest);
      } catch (refreshError) {
        processQueue(refreshError, null);
        // ВАЖНО: logout() без window.location.href —
        // полная перезагрузка страницы создаёт бесконечный цикл.
        // ProtectedRoute сам переведёт на /login через React Router.
        useAuthStore.getState().logout();
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Работа компании приостановлена за неоплату: сервер закрыл запрос. Сообщаем оболочке,
    // чтобы экран с объяснением поднялся сразу, а не через минуту по таймеру опроса.
    if (error.response?.status === 403) {
      const body = error.response.data as { code?: string; message?: { code?: string } } | undefined;
      const code = body?.code ?? body?.message?.code;
      if (code === 'PAYMENT_HOLD') {
        window.dispatchEvent(new CustomEvent('payment-hold:detected'));
      }
    }

    return Promise.reject(error);
  },
);

export default client;
