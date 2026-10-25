import { useEffect, useState, useCallback, useMemo } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { analyticsApi } from '@/api/analytics';
import { adminApi } from '@/api/admin';
import { errorTagsApi } from '@/api/error-tags';
import { PeriodFilter } from '@/components/analytics/PeriodFilter';
import { ErrorFrequencyChart } from '@/components/analytics/ErrorFrequencyChart';
import { ErrorTrendChart } from '@/components/analytics/ErrorTrendChart';
import { ManagerStatsTable } from '@/components/analytics/ManagerStatsTable';
import { ActivityPatternsChart } from '@/components/analytics/ActivityPatternsChart';
import { TagManager } from '@/components/analytics/TagManager';
import { ExportButton } from '@/components/analytics/ExportButton';
import { CompanyPicker } from '@/components/admin/CompanyPicker';
import type {
  ErrorFrequencyData, ErrorTrendData, ManagerStatsData, ErrorTag, ActivityPatternsData,
} from '@/types';
import { Button, Select, Card } from '@chirkov/shell';

type Period = 'all' | 'month' | 'quarter';

export function AnalyticsPage() {
  const user = useAuthStore(s => s.user);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const companyIdParam = searchParams.get('companyId'); // superadmin: ?companyId=X
  const companyId = companyIdParam || user?.companyId || '';

  // Контекст: чью компанию смотрит суперадмин (+ возврат в её карточку — единый «назад к хабу»).
  const [companyName, setCompanyName] = useState('');
  useEffect(() => {
    if (user?.role !== 'superadmin' || !companyIdParam) { setCompanyName(''); return; }
    adminApi.getCompanies()
      .then(({ data }) => setCompanyName(data.find(c => c.id === companyIdParam)?.name ?? ''))
      .catch(() => {});
  }, [companyIdParam, user?.role]);

  const [period, setPeriod] = useState<Period>('all');
  const [frequencyData, setFrequencyData] = useState<ErrorFrequencyData | null>(null);
  const [trendData, setTrendData] = useState<ErrorTrendData | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [managerStats, setManagerStats] = useState<ManagerStatsData | null>(null);
  const [tags, setTags] = useState<ErrorTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activityManagerId, setActivityManagerId] = useState<string>('');
  const [activityData, setActivityData] = useState<ActivityPatternsData | null>(null);

  // Карта частоты тегов: tagId → count (из данных аналитики)
  const tagCounts = useMemo(
    () => new Map((frequencyData?.tags ?? []).map(t => [t.tagId, t.count])),
    [frequencyData],
  );

  const canView = ['reviewer', 'owner', 'superadmin'].includes(user?.role ?? '');

  const loadData = useCallback(async () => {
    if (!companyId || !canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [freqRes, statsRes, tagsRes, actRes] = await Promise.all([
        analyticsApi.getErrorFrequency(companyId, period),
        analyticsApi.getManagerStats(companyId),
        errorTagsApi.getByCompany(companyId),
        analyticsApi.getActivityPatterns(companyId, activityManagerId || undefined),
      ]);
      setFrequencyData(freqRes.data);
      setManagerStats(statsRes.data);
      setTags(tagsRes.data);
      setActivityData(actRes.data);
    } catch {
      setError('Не удалось загрузить аналитику');
    } finally {
      setLoading(false);
    }
  }, [companyId, period, canView, activityManagerId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleTagClick = async (tagId: string) => {
    if (selectedTagId === tagId) {
      setSelectedTagId(null);
      setTrendData(null);
      return;
    }
    setSelectedTagId(tagId);
    setTrendLoading(true);
    try {
      const { data } = await analyticsApi.getErrorTrend(companyId, tagId);
      setTrendData(data);
    } catch {
      setTrendData(null);
    } finally {
      setTrendLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-fg-subtle">Аналитика доступна только руководителям</p>
        </div>
      </div>
    );
  }

  // Superadmin without companyId selected — сразу выбор компании на месте
  if (!companyId && user?.role === 'superadmin') {
    return (
      <div className="space-y-6">
        <CompanyPicker
          title="Выберите компанию для просмотра аналитики"
          subtitle="Тренды по ошибкам, прогресс команды и активность считаются в контексте конкретной компании клиента."
          onPick={id => setSearchParams({ companyId: id })}
        />
      </div>
    );
  }

  if (loading && !frequencyData) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-7 bg-border rounded-card w-44 animate-pulse mb-2" />
            <div className="h-4 bg-surface-sunken rounded-chip w-36 animate-pulse" />
          </div>
          <div className="h-9 bg-border rounded-block w-32 animate-pulse" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card padding="md">
            <div className="h-5 bg-border rounded-chip w-24 animate-pulse mb-5" />
            <div className="space-y-3">
              {[80, 65, 50, 38, 22].map((w, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-5 bg-surface-sunken rounded-chip animate-pulse" style={{ width: `${w}%` }} />
                  <div className="h-4 bg-surface-sunken rounded-chip w-8 animate-pulse" />
                </div>
              ))}
            </div>
          </Card>
          <Card padding="md">
            <div className="h-5 bg-border rounded-chip w-36 animate-pulse mb-5" />
            <div className="h-44 bg-canvas rounded-block animate-pulse" />
          </Card>
        </div>
        <Card padding="md">
          <div className="h-5 bg-border rounded-chip w-36 animate-pulse mb-5" />
          <div className="space-y-3">
            {[1, 2, 3].map(i => <div key={i} className="h-10 bg-canvas rounded-block animate-pulse" />)}
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-page">⚠️</div>
        <div className="text-center">
          <p className="text-fg-muted font-medium">Не удалось загрузить аналитику</p>
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
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="shrink-0">
          {user?.role === 'superadmin' && companyIdParam && (
            <div className="mb-1">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => navigate(`/admin/company/${companyIdParam}`)}
                icon={<ArrowLeft />}
              >
                Карточка компании
              </Button>
            </div>
          )}
          <PageTitle text={companyName ? `Аналитика · ${companyName}` : undefined} />
          <p className="text-fg-subtle mt-1 text-body">
            {frequencyData?.totalReviewed ?? 0} проверено из {frequencyData?.totalEntries ?? 0} записей
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <PeriodFilter value={period} onChange={setPeriod} />
          <ExportButton companyId={companyId} />
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-body-lg font-semibold text-fg">Топ ошибок</h2>
            <span className="text-micro text-fg-subtle">
              {selectedTagId ? 'Нажмите снова, чтобы сбросить' : '← нажмите на тег для тренда'}
            </span>
          </div>
          <ErrorFrequencyChart
            data={frequencyData?.tags ?? []}
            selectedTagId={selectedTagId}
            onTagClick={handleTagClick}
          />
        </Card>

        <Card padding="md">
          <h2 className="text-body-lg font-semibold text-fg mb-4">Тренд по спринтам</h2>
          <ErrorTrendChart data={trendData} loading={trendLoading} />
        </Card>
      </div>

      {/* Manager stats */}
      <Card padding="md">
        <h2 className="text-body-lg font-semibold text-fg mb-4">Прогресс команды</h2>
        <ManagerStatsTable data={managerStats?.managers ?? []} />
      </Card>

      {/* Activity patterns */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          <div>
            <h2 className="text-body-lg font-semibold text-fg">Паттерны активности</h2>
            <p className="text-micro text-fg-subtle mt-0.5">Когда менеджеры чаще всего работают</p>
          </div>
          <div className="w-48">
            <Select
              value={activityManagerId}
              onChange={(e) => setActivityManagerId(e.target.value)}
              aria-label="Фильтр по менеджеру"
            >
              <option value="">Вся команда</option>
              {(managerStats?.managers ?? []).map(m => (
                <option key={m.managerId} value={m.managerId}>{m.fullName}</option>
              ))}
            </Select>
          </div>
        </div>
        {activityData ? <ActivityPatternsChart data={activityData} /> : null}
      </Card>

      {/* Tag management */}
      <Card padding="md">
        <h2 className="text-body-lg font-semibold text-fg mb-4">Управление тегами</h2>
        <TagManager
          companyId={companyId}
          tags={tags}
          onTagsChange={setTags}
          tagCounts={tagCounts}
        />
      </Card>
    </div>
  );
}
