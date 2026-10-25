import { useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { usersApi } from '@/api/users';

/**
 * Личное скрытие/возврат карточки «Первые шаги». Предпочтение живёт на сервере
 * (users.first_steps_hidden_at), поэтому действие применяется только после успешного
 * авторитетного ответа; при ошибке состояние не меняется и можно повторить.
 *
 * Гонка с поздним ответом: запоминаем эпоху сессии (sessionVersion) и автора запроса.
 * Эпоха меняется при login/logout/имперсонации и при фактической смене контекста
 * (id/роль/companyId), но НЕ при ротации accessToken обычным refresh — иначе
 * отложенный ответ после удачного retry терял бы авторитетный результат.
 * Сессия другая — ответ чужой, он ничего не пишет в store.
 *
 * В режиме «Глазами» (impersonator) действий нет: canToggle=false и внутри setHidden
 * тоже — суперадмин не меняет незаметно настройку сотрудника.
 */
export function useFirstStepsHidden() {
  const user = useAuthStore(s => s.user);
  const impersonator = useAuthStore(s => s.impersonator);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const hidden = !!user?.firstStepsHiddenAt;
  const canToggle = !!user && !impersonator;

  const setHidden = async (next: boolean) => {
    const atStart = useAuthStore.getState();
    const author = atStart.user;
    // canToggle внутри действия: поздний вызов из «Глазами»/без сессии не проходит.
    if (!author || !atStart.accessToken || atStart.impersonator || busy) return;
    setBusy(true);
    setError(false);
    try {
      const { data } = await usersApi.setFirstStepsHidden(next);
      // Ответ авторитетен или непригоден: поле обязано приехать, выдуманного штампа нет.
      const stamp = data?.firstStepsHiddenAt;
      if (stamp === undefined || (next && stamp === null) || (!next && stamp !== null)) {
        setError(true);
        return;
      }
      const now = useAuthStore.getState();
      const sameSession = now.sessionVersion === atStart.sessionVersion;
      const sameUser =
        !!now.user &&
        now.user.id === author.id &&
        now.user.role === author.role &&
        now.user.companyId === author.companyId;
      if (!sameSession || !sameUser || now.impersonator) return;
      now.setUser({ ...now.user!, firstStepsHiddenAt: stamp });
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return { hidden, canToggle, busy, error, setHidden };
}
