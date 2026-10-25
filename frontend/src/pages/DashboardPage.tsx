import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Plus, ArrowRight, Inbox, AlertTriangle, Phone, MessageSquare } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { dashboardApi, type ManagerDashboardData, type ReviewerDashboardData } from '@/api/dashboard';
import { SuperAdminDashboard } from './admin/SuperAdminDashboard';
import { ProgressIndicator } from '@/components/sprint/ProgressIndicator';
import { RopBonusProposalCard } from '@/components/dashboard/RopBonusProposalCard';
import { OwnerStateCard } from '@/components/dashboard/OwnerStateCard';
import { CrmHintCard } from '@/components/dashboard/CrmHintCard';
import { ReportChannelsConfirmCard } from '@/components/dashboard/ReportChannelsConfirmCard';
import { GamificationPanel } from '@/components/gamification/GamificationPanel';
import { LevelBadge } from '@/components/gamification/LevelBadge';
import { gamificationApi, type LeaderboardEntry } from '@/api/gamification';
import { analyticsApi } from '@/api/analytics';
import { TelegramLinkButton } from '@/components/settings/TelegramLinkButton';
import { companiesApi } from '@/api/companies';
import { ReviewerStatsCard } from '@/components/analytics/ReviewerStatsCard';
import { UserTour } from '@/components/onboarding/UserTour';
import { FirstStepsCard } from '@/components/onboarding/FirstStepsCard';
import { useFirstStepsHidden } from '@/hooks/useFirstStepsHidden';
import { DeadlineCountdownBanner } from '@/components/dashboard/DeadlineCountdownBanner';
import { RopBonusCard } from '@/components/dashboard/RopBonusCard';
import { ropBonusApi } from '@/api/rop-bonus';
import type { ReviewerStats, RopBonusStats } from '@/types';
import { Avatar, Button, Badge, Notice, Card, EmptyState } from '@chirkov/shell';

// ─── Zone badge ────────────────────────────────────────────────
const ZONE_CONFIG = {
  below: { label: 'Ниже нормы', color: 'warning' },
  good:  { label: 'Норма', color: 'success' },
  great: { label: 'Сильная неделя', color: 'warning' },
} as const;

const ZONE_MOTIVATION: Record<'below' | 'good' | 'great', string> = {
  below: 'Загрузите ещё записей, и выйдете в зону «Норма»',
  good:  'Норма выполнена. Отличный темп, продолжайте',
  great: 'Вы превысили план: сильная неделя.',
};

function ZoneBadge({ zone }: { zone: 'below' | 'good' | 'great' }) {
  const cfg = ZONE_CONFIG[zone];
  return (
    <Badge tone={cfg.color}>{cfg.label}</Badge>
  );
}

// ─── Подпись о конце спринта (срок сдачи записей живёт в баннере, здесь — только спринт) ───
function DeadlineHint({ endDate }: { endDate: string }) {
  const deadline = new Date(endDate);
  const now = new Date();
  const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (daysLeft < 0) return <p className="text-micro text-danger mt-2">Спринт завершён</p>;
  if (daysLeft === 0) return <p className="text-micro text-accent mt-2">Спринт заканчивается сегодня</p>;
  return (
    <p className="text-micro text-fg-subtle mt-2">
      Спринт заканчивается {deadline.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
    </p>
  );
}

// ─── Manager view ───────────────────────────────────────────────
// Постоянная компактная ссылка на помощь: остаётся и после скрытия карточки,
// и после завершения шагов — человек всегда находит первые шаги и пример разбора.
function FirstStepsHelpLink() {
  return (
    <p className="first-steps-actions text-micro">
      <Link to="/manual" className="inline-flex items-center text-accent-hover">Помощь: первые шаги и пример разбора</Link>
    </p>
  );
}

function ManagerDashboard({ data, userId }: { data: ManagerDashboardData; userId: string }) {
  const navigate = useNavigate();
  const { sprint, progress, recentReviewed = [], settings } = data;
  const { hidden: fsHidden, canToggle, busy: fsBusy, error: fsError, setHidden } = useFirstStepsHidden();

  // Чек-лист первых шагов: два собственных действия, отметки по all-time фактам из backend.
  // Поле firstSteps может отсутствовать у ещё не обновлённого backend — тогда считаем
  // по прежним недельным полям, как раньше.
  const firstSteps = [
    { label: 'Загрузить первую запись (звонок или переписку)', done: data.firstSteps?.hasEntries ?? (data.totalEntriesAllTime ?? 0) > 0 },
    { label: 'Заполнить самоанализ: что хорошо, что улучшить, выводы', done: data.firstSteps?.hasSelfReview ?? (progress?.selfReviewCompleted ?? 0) > 0 },
  ];
  const callsEnabled = settings.callsEnabled;
  const chatsEnabled = settings.chatsEnabled;

  // Build fake entries list for ProgressIndicator from progress counts
  // progress.calls.count / progress.chats.count — уже только reviewed (из backend)
  // Добавляем status:'reviewed' чтобы ProgressIndicator корректно их засчитал
  const fakeEntries = [
    ...Array(progress?.calls?.count ?? 0).fill({ type: 'call', status: 'reviewed' }),
    ...Array(progress?.chats?.count ?? 0).fill({ type: 'chat', status: 'reviewed' }),
  ] as { type: 'call' | 'chat'; status: string }[];

  return (
    <div className="space-y-6">
      <div>
        <PageTitle text={`Привет, ${useAuthStore.getState().user?.fullName?.split(' ')[0] ?? 'пользователь'}!`} />
        {sprint && <p className="text-fg-subtle mt-1">Спринт {sprint.label}</p>}
      </div>

      {!fsHidden && (
        <FirstStepsCard
          steps={firstSteps}
          showExample
          onHide={canToggle ? () => setHidden(true) : undefined}
          hideBusy={fsBusy}
          hideError={fsError}
        />
      )}
      <FirstStepsHelpLink />

      {/* Progress block */}
      <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-body-lg font-semibold text-fg">Прогресс недели</h2>
          {progress && <ZoneBadge zone={progress.overallZone} />}
        </div>

        {progress ? (
          <>
            <ProgressIndicator
              entries={fakeEntries as any}
              settings={settings}
              rampUpFactor={progress.rampUpFactor}
            />
            <p className={`text-micro mt-2 ${progress.overallZone === 'great' ? 'text-warning-fg' : progress.overallZone === 'good' ? 'text-success-fg' : 'text-fg-subtle'}`}>
              {ZONE_MOTIVATION[progress.overallZone]}
            </p>
          </>
        ) : (
          <div>
            <p className="text-body text-fg-muted">
              {settings.callsEnabled !== false && `Звонки: 0 из ${settings.callsPerWeek}`}
              {settings.callsEnabled !== false && settings.chatsEnabled !== false && ' · '}
              {settings.chatsEnabled !== false && `Переписки: 0 из ${settings.chatsPerWeek}`}
            </p>
            <p className="text-micro text-fg-subtle mt-1">Загрузите первую запись: разбор занимает около 15 минут. Кнопки ниже.</p>
          </div>
        )}

        {sprint && <DeadlineHint endDate={sprint.endDate} />}

        {/* CTA buttons */}
        <div className="flex flex-col sm:flex-row gap-3 mt-5">
          {callsEnabled && (
            <div className="flex-1">
              <Button
                type="button"
                onClick={() => navigate('/sprint?action=add&type=call')}
                fullWidth
                icon={<Plus />}
              >
                Добавить звонок
              </Button>
            </div>
          )}
          {chatsEnabled && (
            <div className="flex-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => navigate('/sprint?action=add&type=chat')}
                fullWidth
                icon={<Plus />}
              >
                Добавить переписку
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Stats row */}
      {progress && (
        <div className="grid grid-cols-2 gap-3">
          <Card radius="block" padding="sm" className="text-center">
            <p className="text-section font-bold text-fg">{progress.selfReviewCompleted}</p>
            <p className="text-micro text-fg-subtle mt-1">Самоанализов заполнено</p>
          </Card>
          <Card radius="block" padding="sm" className="text-center">
            <p className="text-section font-bold text-fg">{progress.reviewedByRop}</p>
            <p className="text-micro text-fg-subtle mt-1">Получили обратную связь</p>
          </Card>
        </div>
      )}

      {/* Gamification */}
      <GamificationPanel userId={userId} />

      {/* Recent reviews */}
      {recentReviewed.length > 0 && (
        <Card padding="md">
          <h2 className="text-body-lg font-semibold text-fg mb-4">
            Свежая обратная связь{' '}
            <Badge tone="success">{recentReviewed.length}</Badge>
          </h2>
          <div className="space-y-3">
            {recentReviewed.map(entry => (
              <div key={entry.id} className="flex items-start justify-between gap-3 py-2 border-b border-canvas last:border-0">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-body font-medium text-fg">
                    {entry.type === 'call'
                      ? <Phone className="w-3.5 h-3.5 text-fg-disabled flex-shrink-0" aria-hidden="true" />
                      : <MessageSquare className="w-3.5 h-3.5 text-fg-disabled flex-shrink-0" aria-hidden="true" />}
                    {entry.type === 'call' ? 'Звонок' : 'Переписка'} #{entry.entryNumber}
                  </p>
                  {entry.reviewText && (
                    <p className="text-micro text-fg-subtle mt-0.5 truncate">
                      «{entry.reviewText.length > 60 ? entry.reviewText.substring(0, 60) + '…' : entry.reviewText}»
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => navigate(`/sprint?entryId=${entry.id}`)}
                  iconRight={<ArrowRight />}
                >
                  Читать
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* No sprint yet */}
      {!sprint && (
        <Card padding="none" surface="canvas">
          <EmptyState icon={Inbox} title="Спринт ещё не начался" description="Обратитесь к руководителю" />
        </Card>
      )}
    </div>
  );
}

// ─── Reviewer view ──────────────────────────────────────────────
function ReviewerDashboard({ data, companyId, ropBonus }: { data: ReviewerDashboardData; companyId: string; ropBonus: RopBonusStats | null }) {
  const navigate = useNavigate();
  const { sprint, pendingCount, teamMembers = [], settings } = data;
  const callsEnabled = settings.callsEnabled;
  const chatsEnabled = settings.chatsEnabled;
  const user = useAuthStore.getState().user;
  const [teamTab, setTeamTab] = useState<'progress' | 'leaderboard'>('progress');
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [reviewerStats, setReviewerStats] = useState<ReviewerStats | null>(null);
  const { hidden: fsHidden, canToggle, busy: fsBusy, error: fsError, setHidden } = useFirstStepsHidden();

  useEffect(() => {
    if (teamTab !== 'leaderboard' || !companyId) return;
    setLeaderboardLoading(true);
    gamificationApi.getLeaderboard(companyId)
      .then(r => setLeaderboard(r.data))
      .catch(() => {})
      .finally(() => setLeaderboardLoading(false));
  }, [teamTab, companyId]);

  useEffect(() => {
    if (!companyId) return;
    analyticsApi.getReviewerStats(companyId)
      .then(r => setReviewerStats(r.data))
      .catch(() => setReviewerStats(null));
  }, [companyId]);

  // Один измеримый шаг: первое написанное ревью за всё время (all-time флаг из backend,
  // fallback на недельный reviewerStats для необновлённого backend). «Открыть запись»
  // остаётся навигационной подсказкой без галочки: факт открытия нигде не пишется,
  // а пустая очередь не доказывает освоение.
  const ropFirstSteps = [
    { label: 'Написать первое ревью: что хорошо, главная ошибка, рекомендация, а также выбрать теги', done: data.firstSteps?.hasReviews ?? (reviewerStats?.reviewsWritten ?? 0) > 0 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <PageTitle text={`Привет, ${user?.fullName?.split(' ')[0] ?? 'пользователь'}!`} />
        {sprint && <p className="text-fg-subtle mt-1">Спринт {sprint.label}</p>}
      </div>

      {user?.role === 'reviewer' && !fsHidden && (
        <FirstStepsCard
          steps={ropFirstSteps}
          hint="Открыть запись со статусом «Ждёт ревью» на доске спринта"
          onHide={canToggle ? () => setHidden(true) : undefined}
          hideBusy={fsBusy}
          hideError={fsError}
        />
      )}
      {user?.role === 'reviewer' && <FirstStepsHelpLink />}

      {pendingCount > 0 ? (
        <div className="bg-accent-subtle border border-accent-muted rounded-card p-5">
          <div className="flex flex-col items-stretch gap-3 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
            <div>
              <p className="font-semibold text-accent-fg-deep">
                {pendingCount === 1 ? '1 запись ждёт ревью' : `${pendingCount} ${pendingCount >= 2 && pendingCount <= 4 ? 'записи ждут' : 'записей ждут'} ревью`}
              </p>
              <p className="text-body text-accent-hover mt-0.5">Менеджеры ждут вашей обратной связи</p>
            </div>
            <Button
              type="button"
              onClick={() => navigate('/sprint')}
             iconRight={<ArrowRight />}>
              Перейти к ревью
</Button>
          </div>
        </div>
      ) : teamMembers.length > 0 ? (
        <div className="bg-success-subtle border border-success-border rounded-card p-5">
          <div className="flex items-center gap-3">
            <span className="text-section" aria-hidden="true">✓</span>
            <div>
              <p className="font-semibold text-success-fg">Все записи проверены!</p>
              <p className="text-body text-success-fg mt-0.5">Команда получила обратную связь по всем разборам</p>
            </div>
          </div>
        </div>
      ) : null}

      {reviewerStats && <ReviewerStatsCard data={reviewerStats} />}

      {/* Привязка личного Telegram: РОПу — напоминания о ревью, владельцу — отчёты платформы */}
      <Card padding="sm" className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-body text-fg-muted">Уведомления платформы приходят в ваш Telegram</p>
        <TelegramLinkButton />
      </Card>

      {/* Премия РОПа — рендерится только при включённой схеме, иначе дашборд как раньше */}
      {ropBonus?.enabled && <RopBonusCard companyId={companyId} stats={ropBonus} />}

      <Card padding="md">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
          <div className="flex gap-1 bg-surface-sunken p-0.5 rounded-block">
            <Button
              type="button"
              variant={teamTab === 'progress' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTeamTab('progress')}
            >
              Прогресс
            </Button>
            <Button
              type="button"
              variant={teamTab === 'leaderboard' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTeamTab('leaderboard')}
            >
              Рейтинг
            </Button>
          </div>
          {teamTab === 'progress' && teamMembers.length > 0 && (() => {
            const totalReviewed = teamMembers.reduce((s, m) => s + m.reviewedCount, 0);
            const totalEntries = teamMembers.reduce((s, m) => s + (callsEnabled ? m.callCount : 0) + (chatsEnabled ? m.chatCount : 0), 0);
            return <span className="text-body text-fg-subtle">{totalReviewed}/{totalEntries} проверено</span>;
          })()}
        </div>

        {teamTab === 'progress' && (
          <div className="space-y-4">
            {teamMembers.map(member => {
              const total = (callsEnabled ? member.callCount : 0) + (chatsEnabled ? member.chatCount : 0);
              const pct = total > 0 ? Math.round((member.reviewedCount / total) * 100) : 0;
              return (
                <div key={member.id}>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-body font-medium text-fg">{member.fullName}</p>
                    <div className="flex items-center gap-2">
                      {member.pendingCount > 0 && (
                        <Badge tone="accent">{member.pendingCount} ждут</Badge>
                      )}
                      <span className="text-micro text-fg-subtle">{member.reviewedCount}/{total}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-success-fg' : member.pendingCount > 0 ? 'bg-accent-focus' : 'bg-border-strong'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="flex items-center gap-3 text-micro text-fg-subtle mt-1">
                    {callsEnabled && (
                      <span className="inline-flex items-center gap-1">
                        <Phone className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                        <span><span className="sr-only">Звонки: </span>{member.callCount}</span>
                      </span>
                    )}
                    {chatsEnabled && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
                        <span><span className="sr-only">Переписки: </span>{member.chatCount}</span>
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
            {teamMembers.length === 0 && (
              <p className="text-body text-fg-subtle py-2">Записей за этот спринт пока нет</p>
            )}
          </div>
        )}

        {teamTab === 'leaderboard' && (
          <>
            <div className="text-micro text-fg-subtle mb-3">По XP за неделю</div>
            {leaderboardLoading ? (
              <div className="space-y-3 animate-pulse">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-canvas rounded-block" />)}
              </div>
            ) : leaderboard.length === 0 ? (
              <p className="text-body text-fg-subtle py-2">Нет данных о рейтинге</p>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((e, i) => {
                  const MEDALS = ['🥇', '🥈', '🥉'];
                  const MEDAL_LABELS = ['1-е место', '2-е место', '3-е место'];
                  return (
                    <div key={e.id} className={`flex items-center gap-3 p-3 rounded-block ${i === 0 ? 'bg-warning-subtle border border-warning-subtle' : 'hover:bg-canvas'}`}>
                      <span className="w-5 text-center text-body font-bold text-fg-subtle">
                        {i < 3 ? <span role="img" aria-label={MEDAL_LABELS[i]}>{MEDALS[i]}</span> : `${i + 1}`}
                      </span>
                      <Avatar name={e.fullName} src={e.avatarUrl ?? undefined} color={e.color ?? undefined} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-body font-medium text-fg truncate">{e.fullName}</p>
                          <LevelBadge level={e.level} title={e.levelTitle} emoji={e.levelEmoji} size="sm" />
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <div
                            role="progressbar"
                            aria-valuenow={leaderboard[0].weeklyXp > 0 ? Math.round((e.weeklyXp / leaderboard[0].weeklyXp) * 100) : 0}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${e.fullName}: ${e.weeklyXp} XP за неделю`}
                            className="flex-1 h-1.5 bg-surface-sunken rounded-full overflow-hidden max-w-[120px]"
                          >
                            <div className="h-full bg-accent-focus rounded-full" style={{ width: `${leaderboard[0].weeklyXp > 0 ? Math.round((e.weeklyXp / leaderboard[0].weeklyXp) * 100) : 0}%` }} />
                          </div>
                          <span className="text-micro text-fg-subtle">+{e.weeklyXp} XP</span>
                          {e.currentStreak > 0 && (
                            <span className="text-micro text-accent-hover">
                              <span role="img" aria-label="серия">🔥</span>{e.currentStreak}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-micro text-fg-subtle flex-shrink-0">{e.totalXp} всего</span>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-micro text-fg-subtle mt-3">
              XP отражает вовлечённость, а не качество работы. Для оценки команды используйте раздел «Аналитика».
            </p>
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────
export function DashboardPage() {
  const user = useAuthStore(s => s.user);
  const [managerData, setManagerData] = useState<ManagerDashboardData | null>(null);
  const [reviewerData, setReviewerData] = useState<ReviewerDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [ropBonus, setRopBonus] = useState<RopBonusStats | null>(null);

  const companyId = user?.companyId ?? '';

  const [tourParams] = useSearchParams();

  // Onboarding tour — при первом входе или по ссылке «Показать тур ещё раз» (?tour=1)
  useEffect(() => {
    if (user && user.role !== 'superadmin' && user.role !== 'tracker' && (!user.onboardingSeenAt || tourParams.get('tour') === '1')) {
      setShowTour(true);
    }
  }, [user, tourParams]);

  // Легитимное «спринта ещё нет» приходит от backend как успешный ответ (sprint: null внутри data) —
  // сюда попадаем только при реальной ошибке загрузки (сеть/5xx/таймаут), поэтому различаем это состояние
  // от пустого отдельным флагом, а не молчим под видом «нет спринта».
  const loadDashboard = useCallback(async () => {
    if (!companyId || user?.role === 'superadmin' || user?.role === 'tracker') {
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(false);
    try {
      if (user?.role === 'manager') {
        const { data } = await dashboardApi.getManagerData(companyId, user.id);
        setManagerData(data);
      } else if (user?.role === 'reviewer' || user?.role === 'owner') {
        const { data } = await dashboardApi.getReviewerData(companyId);
        setReviewerData(data);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [companyId, user]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // Премия РОПа — отдельный запрос, ошибки не блокируют дашборд
  useEffect(() => {
    if (!companyId || (user?.role !== 'reviewer' && user?.role !== 'owner')) return;
    ropBonusApi.getMonth(companyId)
      .then(r => setRopBonus(r.data))
      .catch(() => setRopBonus(null));
  }, [companyId, user]);

  // Гейт защиты петли: владельцу без каналов отчётов показываем баннер —
  // без отчётов разбор идёт «молча», и это доказанный сценарий смерти петли
  const [ownerChannelsEmpty, setOwnerChannelsEmpty] = useState(false);
  useEffect(() => {
    if (!companyId || user?.role !== 'owner') return;
    companiesApi.getSettings(companyId)
      .then(({ data }) => {
        const wa = (data as { reportChannels?: { weeklyAccountability?: { emails?: string[]; telegramChatIds?: string[] } } })
          .reportChannels?.weeklyAccountability;
        setOwnerChannelsEmpty((wa?.emails?.length ?? 0) === 0 && (wa?.telegramChatIds?.length ?? 0) === 0);
      })
      .catch(() => setOwnerChannelsEmpty(false));
  }, [companyId, user]);

  // deadline-дни приходят атомарно с dashboard data (одним запросом, без race condition)
  const dashboardSettings = managerData?.settings ?? reviewerData?.settings ?? null;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-border rounded-card w-48 animate-pulse" />
        <Card padding="md" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 bg-border rounded-chip w-28 animate-pulse" />
            <div className="h-5 bg-surface-sunken rounded-full w-20 animate-pulse" />
          </div>
          <div className="space-y-2">
            <div className="h-3 bg-surface-sunken rounded-full animate-pulse" />
            <div className="h-3 bg-surface-sunken rounded-full animate-pulse w-4/5" />
          </div>
          <div className="flex gap-3 mt-2">
            <div className="flex-1 h-10 bg-accent-subtle-hover rounded-block animate-pulse" />
            <div className="flex-1 h-10 bg-accent-subtle rounded-block animate-pulse" />
          </div>
        </Card>
        <div className="grid grid-cols-2 gap-3">
          <Card radius="block" padding="sm" className="h-20 animate-pulse" />
          <Card radius="block" padding="sm" className="h-20 animate-pulse" />
        </div>
      </div>
    );
  }

  // Трекер видит тот же дашборд-список компаний, что и суперадмин (свой компании у него нет).
  if (user?.role === 'superadmin' || user?.role === 'tracker') return <SuperAdminDashboard />;

  // Подсчёт «срочных» задач для countdown-баннера
  const managerPending = managerData
    ? Math.max(
        0,
        ((managerData.settings.callsPerWeek ?? 0) - (managerData.progress?.calls?.count ?? 0)) +
        ((managerData.settings.chatsPerWeek ?? 0) - (managerData.progress?.chats?.count ?? 0)),
      )
    : 0;
  const reviewerPending = reviewerData?.pendingCount ?? 0;

  return (
    <>
      {showTour && <UserTour onClose={() => setShowTour(false)} ropBonusEnabled={ropBonus?.enabled === true} ropBonusTiers={ropBonus?.tiers ?? []} />}

      {/* Пятница отличается от вторника: если норматив закрыт — неделя сдана, заходить незачем.
          Показываем только в пятницу: «закрыто» во вторник выключило бы ежедневный ритм. */}
      {user?.role === 'manager' && managerData && managerPending <= 0 && new Date().getDay() === 5 && (
        <div className="bg-success-subtle border border-success-border rounded-card px-5 py-4 mb-6">
          <p className="text-body font-semibold text-success-fg">Неделя закрыта</p>
          <p className="text-body text-success-fg mt-0.5">
            Все записи сданы, разбор у руководителя. Сегодня можно не заходить: увидимся в понедельник.
          </p>
        </div>
      )}

      {user?.role === 'manager' && managerData && managerPending > 0 && (
        (managerData.totalEntriesAllTime ?? 1) === 0 ? (
          // Новичок без единой записи: спокойный старт вместо паники дедлайна
          <div className="bg-success-subtle border border-success-border rounded-card px-5 py-4 mb-6">
            <p className="text-body text-success-fg">
              Первая неделя: разминка. Загрузите одну запись, и РОП разберёт её и подскажет, что улучшить.
            </p>
          </div>
        ) : (
          <DeadlineCountdownBanner
            role="manager"
            deadlineDay={dashboardSettings?.managerDeadlineDay ?? 'friday'}
            pending={managerPending}
          />
        )
      )}
      {/* У РОПа нет дня-дедлайна: норматив — 24 часа на каждую запись, и обратный отсчёт до
          пятницы конкурировал с ним, разрешая копить записи до конца недели. Очередь и срок
          показывает карточка показателей ниже. */}

      {/* Экран состояния собственника стоит ПЕРВЫМ: он отвечает на вопросы, ради которых
          человек и зашёл, а разбор недели по спринту ниже. Когда всё в норме, это одна строка. */}
      {user?.role === 'owner' && companyId && <OwnerStateCard companyId={companyId} />}

      {/* Единственное решение онбординга, которое нельзя принять за владельца. Раньше держало его
          шлагбаумом в мастере, теперь ждёт здесь и исчезает, как только решение принято. */}
      {user?.role === 'owner' && <RopBonusProposalCard />}

      {/* Каналы проставил трекер — владелец сверяет адрес одной кнопкой. Пустые каналы
          ловит оранжевый баннер ниже, эта карточка про «проставлено, но верно ли». */}
      {user?.role === 'owner' && companyId && !ownerChannelsEmpty && (
        <ReportChannelsConfirmCard companyId={companyId} />
      )}

      {user?.role === 'owner' && ownerChannelsEmpty && (
        <div className="mb-6">
          <Notice
            tone="warning"
            title="Отчёты о разборе ошибок не подключены"
            action={<TelegramLinkButton onLinked={() => setOwnerChannelsEmpty(false)} />}
          >
            <p>Вы не увидите, как команда разбирает ошибки. Подключите Telegram в один клик: еженедельный отчёт и алерты будут приходить вам.</p>
          </Notice>
        </div>
      )}

      {/* Звонки носят руками, хотя CRM можно подключить. Показывается только когда наша
          команда не отметила «подключать нечем» и подсказку не откладывали. */}
      {(user?.role === 'reviewer' || user?.role === 'owner') && (
        <CrmHintCard canConnect={user?.role === 'owner'} />
      )}

      {(user?.role === 'reviewer' || user?.role === 'owner') && reviewerData ? (
        <ReviewerDashboard data={reviewerData} companyId={companyId} ropBonus={ropBonus} />
      ) : user?.role === 'manager' && managerData ? (
        <ManagerDashboard data={managerData} userId={user.id} />
      ) : loadError ? (
        <div className="space-y-6">
          <div className="bg-danger-subtle rounded-card border border-danger-border p-8 text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-danger" aria-hidden="true" />
            <p className="text-danger-fg text-body font-medium">Не удалось загрузить данные дашборда</p>
            <p className="text-danger text-micro mt-1">Проверьте соединение и попробуйте обновить</p>
            <div className="mt-4">
              <Button variant="danger" size="md"
                onClick={() => loadDashboard()}
              >
                Обновить
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <Card padding="none" surface="canvas">
            <EmptyState
              icon={Inbox}
              title="Нет данных за текущий спринт"
              description="Спринт ещё не начался или данных пока нет"
            />
          </Card>
        </div>
      )}
    </>
  );
}
