import { useEffect, useState } from 'react';
import { playbookApi } from '@/api/playbook';
import { useAuthStore } from '@/stores/authStore';

/**
 * Счётчик кандидатов методички для бейджа в сайдбаре — РОП/владелец не должны заметить
 * находку только по случайному заходу на страницу «Методичка» (решение владельца продукта:
 * систему саму находит повтор, а не РОП вручную — значит и сигнал о находке обязан быть
 * заметен сам, а не спрятан внутри раздела).
 *
 * Временно не подключён нигде (Этап Б переезда на @chirkov/shell, 23.09.2026):
 * `NavItemConfig` пакета не несёт бейджа/счётчика на пункте меню, поэтому визуальный
 * сигнал в меню пропал. Хук оставлен как готовая логика для восстановления, когда
 * в пакете появится поддержка счётчика на NavItem — см. отчёт по Этапу Б.
 */
export function usePlaybookCandidatesCount(): number {
  const user = useAuthStore((s) => s.user);
  const [count, setCount] = useState(0);
  const canManage = user?.role === 'reviewer' || user?.role === 'owner' || user?.role === 'superadmin';
  const companyId = user?.companyId ?? undefined;

  useEffect(() => {
    if (!canManage || !companyId) return;
    let cancelled = false;
    const load = () => {
      playbookApi.getProgress(companyId)
        .then(({ data }) => { if (!cancelled) setCount(data.candidatesWaiting); })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [canManage, companyId]);

  return canManage ? count : 0;
}
