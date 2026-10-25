import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { Link, useSearchParams } from 'react-router-dom';
import { GraduationCap, Plus, ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { attestationApi } from '@/api/attestation';
import { adminApi } from '@/api/admin';
import { CompanyPicker } from '@/components/admin/CompanyPicker';
import { GenerateTestDialog } from '@/components/attestation/GenerateTestDialog';
import { TestCard } from '@/components/attestation/TestCard';
import { Button, Card, EmptyState } from '@chirkov/shell';
import type { AttestationTest, AttestationAttempt } from '@/types';

const MY_STATUS_LABEL: Record<AttestationAttempt['status'], string> = {
  assigned: 'Начать',
  submitted: 'Оценивается…',
  ai_graded: 'Оценивается…',
  graded: 'Результат',
};

export function AttestationPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const companyIdParam = searchParams.get('companyId');
  const companyId = companyIdParam || user?.companyId || '';
  const canManage = ['reviewer', 'owner', 'superadmin'].includes(user?.role ?? '');
  const isManager = user?.role === 'manager';

  const [companyName, setCompanyName] = useState('');
  useEffect(() => {
    if (user?.role !== 'superadmin' || !companyIdParam) { setCompanyName(''); return; }
    adminApi.getCompanies().then(({ data }) => setCompanyName(data.find((c) => c.id === companyIdParam)?.name ?? '')).catch(() => {});
  }, [companyIdParam, user?.role]);

  const [tests, setTests] = useState<AttestationTest[]>([]);
  const [myAttempts, setMyAttempts] = useState<AttestationAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (isManager) {
        const { data } = await attestationApi.listMy();
        setMyAttempts(data);
      } else if (companyId) {
        const { data } = await attestationApi.listTests(companyId);
        setTests(data);
      }
    } finally {
      setLoading(false);
    }
  }, [companyId, isManager]);

  useEffect(() => { load(); }, [load]);

  if (!isManager && !companyId && user?.role === 'superadmin') {
    return (
      <div className="space-y-6">
        <CompanyPicker title="Выберите компанию" subtitle="Аттестации собираются из карточек методички конкретной компании." onPick={(id) => setSearchParams({ companyId: id })} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-7 bg-border rounded-card w-56 animate-pulse" />
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 bg-surface-sunken rounded-card animate-pulse" />)}</div>
      </div>
    );
  }

  if (isManager) {
    return (
      <div className="space-y-6">
        {myAttempts.length === 0 ? (
          <Card padding="none" surface="canvas">
            <EmptyState icon={GraduationCap} title="Пока нет назначенной аттестации" description="Появится здесь, когда руководитель назначит проверку по методичке." />
          </Card>
        ) : (
          <div className="space-y-3">
            {myAttempts.map((a) => (
              <Card
                as={Link}
                key={a.id}
                to={a.status === 'assigned' ? `/attestation/take/${a.id}` : a.status === 'graded' ? `/attestation/result/${a.id}` : '#'}
                padding="md"
                interactive
                className="flex items-center justify-between"
              >
                  <div>
                    <h3 className="font-heading font-semibold text-fg">{a.test?.title ?? 'Аттестация'}</h3>
                    {a.status === 'graded' && (
                      <p className={`text-micro mt-1 ${a.passed ? 'text-success-fg' : 'text-danger-fg'}`}>
                        {a.totalScorePercent}% · {a.passed ? 'сдал' : 'не сдал'}
                      </p>
                    )}
                  </div>
                  <span className="flex items-center gap-1.5 text-body font-medium text-accent-hover">
                    {MY_STATUS_LABEL[a.status]} <ChevronRight className="w-4 h-4" />
                  </span>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <PageTitle text={companyName ? `Аттестация · ${companyName}` : undefined} />
          <p className="text-body text-fg-subtle mt-1">Вопросы из карточек, которые команда уже утвердила. Баллы предлагает платформа, решение всегда за вами.</p>
        </div>
        {canManage && (
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setDialogOpen(true)}
            icon={<Plus />}
          >
            Назначить аттестацию
          </Button>
        )}
      </div>

      {tests.length === 0 ? (
        <Card padding="none" surface="canvas">
          <EmptyState icon={GraduationCap} title="Аттестаций пока не было" description="Как только в методичке накопятся активные карточки, можно собрать первый тест: вопросы платформа напишет сама." />
        </Card>
      ) : (
        <div className="space-y-3">
          {tests.map((t) => <TestCard key={t.id} test={t} companyId={companyId} onChanged={load} />)}
        </div>
      )}

      {dialogOpen && (
        <GenerateTestDialog companyId={companyId} onClose={() => setDialogOpen(false)} onCreated={() => { setDialogOpen(false); load(); }} />
      )}
    </div>
  );
}
