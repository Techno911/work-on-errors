import { useEffect, useState } from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import { adminApi, type AdminCompanyMetrics } from '@/api/admin';
import { StaffSummary } from './StaffSummary';
import { Card, ListRow } from '@chirkov/shell';

// Инлайн-выбор компании для суперадмина — вместо тупика «зайдите с Главной».
// Выбор ведёт сразу в целевой раздел (onPick), без лишнего прыжка на дашборд.
export function CompanyPicker({
  title,
  subtitle,
  onPick,
}: {
  title: string;
  subtitle: string;
  onPick: (companyId: string) => void;
}) {
  const [companies, setCompanies] = useState<AdminCompanyMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminApi.getCompanies()
      .then(r => setCompanies(r.data))
      .catch(() => { /* пустой список покажем ниже */ })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-2xl mx-auto">
      <Card padding="md">
      <h2 className="text-body-lg font-semibold text-fg mb-1">{title}</h2>
      <p className="text-micro text-fg-subtle mb-4">{subtitle}</p>
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 bg-canvas rounded-card animate-pulse" />)}
        </div>
      ) : companies.length === 0 ? (
        <p className="text-body text-fg-subtle py-3">Компаний пока нет. Создайте первую на Главной.</p>
      ) : (
        <div className="divide-y divide-border">
          {companies.map(c => (
            <ListRow key={c.id} type="button" onClick={() => onPick(c.id)} icon={<Building2 />}>
              <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-body-lg font-normal text-fg">
                <span className="flex-1 min-w-40 break-words">{c.name}</span>
                <span className="min-w-0 max-w-full text-micro text-fg-subtle">
                  <StaffSummary managers={c.managersCount} reviewers={c.reviewersCount} />
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-fg-subtle flex-shrink-0 self-center" aria-hidden="true" />
            </ListRow>
          ))}
        </div>
      )}
    </Card>
    </div>
  );
}
