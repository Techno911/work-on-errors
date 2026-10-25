import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useSearchParams } from 'react-router-dom';
import { BookMarked, Plus } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { playbookApi } from '@/api/playbook';
import { adminApi } from '@/api/admin';
import { CompanyPicker } from '@/components/admin/CompanyPicker';
import { PlaybookProgressBar } from '@/components/playbook/PlaybookProgressBar';
import { PlaybookCandidateCard } from '@/components/playbook/PlaybookCandidateCard';
import { PlaybookCardItem } from '@/components/playbook/PlaybookCardItem';
import { PlaybookExportButton } from '@/components/playbook/PlaybookExportButton';
import { PlaybookManualCardDialog } from '@/components/playbook/PlaybookManualCardDialog';
import type { PlaybookCard, PlaybookProgress } from '@/types';
import { Button, Card, EmptyState } from '@chirkov/shell';

export function PlaybookPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const companyIdParam = searchParams.get('companyId');
  const companyId = companyIdParam || user?.companyId || '';

  const [companyName, setCompanyName] = useState('');
  useEffect(() => {
    if (user?.role !== 'superadmin' || !companyIdParam) { setCompanyName(''); return; }
    adminApi.getCompanies()
      .then(({ data }) => setCompanyName(data.find((c) => c.id === companyIdParam)?.name ?? ''))
      .catch(() => {});
  }, [companyIdParam, user?.role]);

  const canManage = ['reviewer', 'owner', 'superadmin'].includes(user?.role ?? '');

  const [progress, setProgress] = useState<PlaybookProgress | null>(null);
  const [candidates, setCandidates] = useState<PlaybookCard[]>([]);
  const [activeCards, setActiveCards] = useState<PlaybookCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [manualDialogOpen, setManualDialogOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!companyId) { setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const requests: [Promise<{ data: PlaybookProgress }>, Promise<{ data: PlaybookCard[] }>, Promise<{ data: PlaybookCard[] }> | null] = [
        playbookApi.getProgress(companyId),
        playbookApi.getActiveCards(companyId),
        canManage ? playbookApi.getCandidates(companyId) : null,
      ];
      const [progressRes, activeRes, candidatesRes] = await Promise.all(requests);
      setProgress(progressRes.data);
      setActiveCards(activeRes.data);
      setCandidates(candidatesRes?.data ?? []);
    } catch {
      setError('Не удалось загрузить методичку');
    } finally {
      setLoading(false);
    }
  }, [companyId, canManage]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!companyId && user?.role === 'superadmin') {
    return (
      <div className="space-y-6">
        <CompanyPicker
          title="Выберите компанию, чтобы посмотреть методичку"
          subtitle="Карточки собираются из разборов звонков и переписок конкретной компании клиента."
          onPick={(id) => setSearchParams({ companyId: id })}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-7 bg-border rounded-card w-56 animate-pulse" />
        <div className="h-20 bg-surface-sunken rounded-card animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-canvas rounded-card animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-page">⚠️</div>
        <div className="text-center">
          <p className="text-fg-muted font-medium">Не удалось загрузить методичку</p>
          <p className="text-fg-subtle text-body mt-1">Проверьте подключение и попробуйте снова</p>
        </div>
        <Button
          type="button"
          onClick={loadData}
        >
          Попробовать снова
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <PageTitle text={companyName ? `Методичка · ${companyName}` : undefined} />
          <p className="text-body text-fg-subtle mt-1">
            Правила, которые команда собрала на своих же ошибках. Своя, не из интернета.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <Button variant="secondary" size="md"
              onClick={() => setManualDialogOpen(true)}
              icon={<Plus />}
            >
              Своя карточка
            </Button>
          )}
          <PlaybookExportButton companyId={companyId} disabled={activeCards.length === 0} />
        </div>
      </div>

      {progress && <PlaybookProgressBar progress={progress} />}

      {canManage && candidates.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-body font-semibold text-fg-muted uppercase tracking-overline">
            Ждут вашего решения · {candidates.length}
          </h2>
          {candidates.map((c) => (
            <PlaybookCandidateCard key={c.id} candidate={c} companyId={companyId} onResolved={loadData} />
          ))}
        </div>
      )}

      <div className="space-y-3">
        {activeCards.length === 0 ? (
          <Card padding="none" surface="canvas">
            <EmptyState
              icon={BookMarked}
              title="Методичка пока пуста"
              description={canManage
                ? 'Карточки появятся сами: как только одна и та же ошибка повторится в нескольких разборах, платформа предложит вам подтвердить правило.'
                : 'Как только руководитель подтвердит первые правила, они появятся здесь.'}
            />
          </Card>
        ) : (
          activeCards.map((c) => (
            <PlaybookCardItem key={c.id} card={c} companyId={companyId} canManage={canManage} onChanged={loadData} />
          ))
        )}
      </div>

      {manualDialogOpen && (
        <PlaybookManualCardDialog
          companyId={companyId}
          onClose={() => setManualDialogOpen(false)}
          onCreated={() => { setManualDialogOpen(false); loadData(); }}
        />
      )}
    </div>
  );
}
