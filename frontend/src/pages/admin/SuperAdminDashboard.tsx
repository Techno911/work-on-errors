import { pluralRu } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Plus, Users, Settings, Flame, ShieldAlert, Moon, Send } from 'lucide-react';
import { adminApi, type AdminCompanyMetrics } from '@/api/admin';
import { CreateCompanyModal } from '@/components/admin/CreateCompanyModal';
import { StaffSummary } from '@/components/admin/StaffSummary';
import { CompanyStatusBadge } from '@/components/admin/CompanyStatusBadge';
import { TrackersSection } from '@/components/admin/TrackersSection';
import { WatchdogsSection } from '@/components/admin/WatchdogsSection';
import { useAuthStore } from '@/stores/authStore';
import { Button, Badge, Card } from '@chirkov/shell';

const LOOP_REASON_LABELS: Record<string, string> = {
  no_owner_channels: 'владелец без каналов отчётов',
  rop_discipline_not_chosen: 'контур дисциплины РОПа не выбран',
};

const HEALTH_CONFIG = {
  good: { icon: '●', color: 'var(--color-success)', label: 'Хорошо', text: 'text-success-fg', badgeColor: 'success' },
  warning: { icon: '●', color: 'var(--color-warning)', label: 'Внимание', text: 'text-warning-fg', badgeColor: 'warning' },
  critical: { icon: '●', color: 'var(--color-danger)', label: 'Проблема', text: 'text-danger-fg', badgeColor: 'danger' },
} as const;

const HEALTH_TONE = { good: 'success', warning: 'warning', critical: 'danger' } as const;

function CompanyCard({ company, onOpen }: { company: AdminCompanyMetrics; onOpen: () => void }) {
  const navigate = useNavigate();
  const h = HEALTH_CONFIG[company.health];
  const pendingCount = company.currentSprint
    ? company.currentSprint.entriesCount - company.currentSprint.reviewedCount
    : 0;

  return (
    <Card padding="sm" radius="block" tone={HEALTH_TONE[company.health]}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          onClick={onOpen}
          variant="ghost"
          size="md"
          fullWidth
          aria-label={`Открыть компанию ${company.name}`}
          icon={<span className="text-title">{h.icon}</span>}
        >
          <span className="min-w-0 text-left font-normal block">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-fg">{company.name}</p>
              <CompanyStatusBadge status={company.status} />
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1 text-micro text-fg-subtle">
                <Users className="w-3.5 h-3.5 flex-shrink-0" /> <StaffSummary managers={company.managersCount} reviewers={company.reviewersCount} owners={company.ownersCount} />
              </span>
              {company.currentSprint ? (
                <>
                  <span className="text-micro text-fg-subtle">{company.currentSprint.label}</span>
                  <Badge tone={h.badgeColor}>
                    {company.currentSprint.completionRate}%
                  </Badge>
                  <span className="text-micro text-fg-subtle">
                    {company.currentSprint.reviewedCount}/{company.currentSprint.entriesCount} проверено
                  </span>
                  {pendingCount > 0 && (
                    <Badge tone="accent">{pendingCount} ждут ревью</Badge>
                  )}
                </>
              ) : company.offerPending ? (
                <Badge tone="warning">
                  <Send className="w-3.5 h-3.5 flex-shrink-0" /> Оферта не принята
                </Badge>
              ) : !company.onboardingCompleted ? (
                <span className="inline-flex items-center gap-1 text-micro text-warning-fg font-medium">
                  <Settings className="w-3.5 h-3.5 flex-shrink-0" /> Онбординг не завершён
                </span>
              ) : (
                <span className="text-micro text-fg-subtle">Нет активного спринта</span>
              )}
              {!company.loopProtected && (
                <Badge
                  tone="danger"
                  title={company.loopProtectionReasons.map(r => LOOP_REASON_LABELS[r] ?? r).join('; ')}
                >
                  <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" /> петля не защищена
                </Badge>
              )}
              {(company.daysQuiet ?? 0) >= 3 && (
                <Badge tone="neutral">
                  <Moon className="w-3.5 h-3.5 flex-shrink-0" /> тихо {company.daysQuiet} {pluralRu(company.daysQuiet!, 'день', 'дня', 'дней')}
                </Badge>
              )}
              {company.teamStreakHasTeam && company.teamStreak > 0 && (
                <Badge tone="neutral">
                  <Flame className="w-3.5 h-3.5 text-accent flex-shrink-0" /> серия {company.teamStreak} {pluralRu(company.teamStreak, 'неделя', 'недели', 'недель')}
                </Badge>
              )}
              {company.ropBonusForecast && (
                <span className="text-micro text-fg-subtle">
                  премия {company.ropBonusForecast.onTimePct ?? 0}% · {company.ropBonusForecast.currentAmount.toLocaleString('ru-RU')} ₽
                </span>
              )}
            </div>
          </span>
        </Button>
        <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-auto">
          <Button
            type="button"
            onClick={() => navigate(`/sprint?companyId=${company.id}`)}
            variant="ghost"
            size="sm"
            title="Открыть доску спринта"
          >
            Доска
          </Button>
          <Button
            type="button"
            onClick={onOpen}
            variant="link"
            size="sm"
           iconRight={<ArrowRight />}>
            Открыть
</Button>
        </div>
      </div>
    </Card>
  );
}

export function SuperAdminDashboard() {
  const navigate = useNavigate();
  // Управление трекерами видит и правит только суперадмин; трекер видит тот же дашборд без этой секции.
  const isSuperadmin = useAuthStore(s => s.user?.role) === 'superadmin';
  const [companies, setCompanies] = useState<AdminCompanyMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const load = async () => {
    try {
      const { data } = await adminApi.getCompanies();
      setCompanies(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-fg-subtle text-body">Загрузка компаний...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-fg-subtle mt-1">Все компании • {companies.length} {pluralRu(companies.length, 'клиент', 'клиента', 'клиентов')}</p>
        </div>
        <Button
          type="button"
          onClick={() => setShowCreate(true)}
          icon={<Plus />}
        >
          Создать компанию
        </Button>
      </div>

      {/* Требуют настройки (оферта не принята / онбординг не завершён) — отдельной группой сверху,
          иначе горящие клиенты теряются среди работающих. Внутри: оферта-пендинг вперёд. */}
      {(() => {
        // «Ещё не запущена» = нет активного спринта И онбординг не завершён.
        // Легаси-компании с активным спринтом (offerAccepted=false, но рабочие) сюда НЕ попадают.
        const isSetup = (c: AdminCompanyMetrics) => !c.onboardingCompleted && !c.currentSprint;
        const needsSetup = companies
          .filter(isSetup)
          .sort((a, b) => Number(a.offerAccepted) - Number(b.offerAccepted));
        const live = companies
          .filter(c => !isSetup(c))
          .sort((a, b) => {
            const rank = { critical: 0, warning: 1, good: 2 };
            return rank[a.health] - rank[b.health];
          });
        return (
          <>
            {needsSetup.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Flame className="w-4 h-4 text-accent" />
                  <h2 className="text-body font-semibold text-fg-muted">
                    Требуют настройки · {needsSetup.length}
                  </h2>
                  <span className="text-micro text-fg-subtle">ещё не запущены: примите оферту и заведите команду</span>
                </div>
                {needsSetup.map((c) => (
                  <CompanyCard key={c.id} company={c} onOpen={() => navigate(`/admin/company/${c.id}`)} />
                ))}
              </div>
            )}

            {live.length > 0 && (
              <div className="space-y-3">
                {needsSetup.length > 0 && (
                  <h2 className="text-body font-semibold text-fg-muted">Работают · {live.length}</h2>
                )}
                {live.map((c) => (
                  <CompanyCard key={c.id} company={c} onOpen={() => navigate(`/admin/company/${c.id}`)} />
                ))}
              </div>
            )}

            {companies.length === 0 && (
              <div className="text-center py-12 text-fg-subtle text-body">
                Нет компаний. Создайте первую!
              </div>
            )}
          </>
        );
      })()}

      {isSuperadmin && <WatchdogsSection />}

      {isSuperadmin && <TrackersSection />}

      {showCreate && (
        <CreateCompanyModal
          onClose={() => setShowCreate(false)}
          onCreated={(companyId) => { setShowCreate(false); navigate(`/admin/company/${companyId}`); }}
        />
      )}
    </div>
  );
}
