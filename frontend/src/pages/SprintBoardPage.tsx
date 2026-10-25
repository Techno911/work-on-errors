import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import { sprintsApi } from '@/api/sprints';
import { entriesApi, errorTagsApi } from '@/api/entries';
import { companiesApi } from '@/api/companies';
import { adminApi } from '@/api/admin';
import { SprintHeader } from '@/components/sprint/SprintHeader';
import { ManagerSection } from '@/components/sprint/ManagerSection';
import { TeamProgressBar } from '@/components/sprint/TeamProgressBar';
import { CompanyPicker } from '@/components/admin/CompanyPicker';
import type { Sprint, Entry, ErrorTag, User, CompanySettings } from '@/types';
import { Button, Card } from '@chirkov/shell';

export function SprintBoardPage() {
  const { sprintId } = useParams<{ sprintId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore(s => s.user);

  const [sprint, setSprint] = useState<Sprint | null>(null);
  // Какая неделя сейчас идёт. Нужна, чтобы человек, открывший прошлую неделю, видел прямой
  // выход к текущей, а не догадывался о нём по серой стрелке «След.».
  const [currentSprintId, setCurrentSprintId] = useState<string | null>(null);
  const [allSprints, setAllSprints] = useState<Sprint[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [errorTags, setErrorTags] = useState<ErrorTag[]>([]);
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Записи «Ждёт ревью» в других спринтах — чтобы пустая доска не была тупиком для РОПа
  const [pendingElsewhere, setPendingElsewhere] = useState<{ count: number; sprintId: string } | null>(null);
  // «Отревьюил → следующая»: id записи, к которой перепрыгиваем по кнопке (раскрыть + прокрутить).
  const [focusEntryId, setFocusEntryId] = useState<string | null>(null);

  // Deep-link params
  const actionParam = searchParams.get('action');
  const typeParam = searchParams.get('type') as 'call' | 'chat' | null;
  const entryIdParam = searchParams.get('entryId'); // авто-открытие из уведомления
  const companyIdParam = searchParams.get('companyId'); // superadmin: ?companyId=X
  const [showAddForm, setShowAddForm] = useState(actionParam === 'add');

  // Superadmin can pass ?companyId=X; regular users use their own companyId
  const companyId = companyIdParam || user?.companyId || '';

  // Разгонная неделя (запуск не с понедельника): множитель урезания порогов для баров менеджеров.
  const [rampUpFactor, setRampUpFactor] = useState(1);
  // Контекст: чью компанию открыл суперадмин (+ возврат в её карточку — единый «назад к хабу»).
  const [companyName, setCompanyName] = useState('');
  useEffect(() => {
    if (user?.role !== 'superadmin' || !companyIdParam) { setCompanyName(''); return; }
    adminApi.getCompanies()
      .then(({ data }) => setCompanyName(data.find(c => c.id === companyIdParam)?.name ?? ''))
      .catch(() => {});
  }, [companyIdParam, user?.role]);

  const loadSprint = useCallback(async (id?: string, signal?: AbortSignal) => {
    if (!companyId) {
      setLoading(false);
      setError('Компания не выбрана');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Текущую неделю спрашиваем ВСЕГДА, даже когда открыт конкретный спринт по адресу.
      // Неделя заводится лениво, первым обращением к /sprints/current: человек, оставшийся
      // на прошлой неделе (перешёл кнопкой «Пред.» или из «записи ждут в другом спринте»),
      // после этого живёт по адресу /sprint/<id прошлой недели> и сколько бы страницу ни
      // обновлял, новая неделя у него не появится, а стрелка «След.» будет серой, потому
      // что следующего спринта в базе просто нет. 24.08.2026 так и вышло у РОПа одного клиента:
      // «новая неделя не активирована», обновлял несколько раз, не помогало; неделя завелась
      // только когда доску открыл менеджер, зашедший обычным путём. Запрос идемпотентный.
      const [sprintRes, currentRes, tagsRes, settingsRes] = await Promise.all([
        id ? sprintsApi.getById(id) : sprintsApi.getCurrent(companyId),
        sprintsApi.getCurrent(companyId),
        errorTagsApi.getAll(companyId),
        companiesApi.getSettings(companyId),
      ]);
      // Список берём ПОСЛЕ current, иначе только что заведённая неделя в него не попадёт
      // (гонка двух параллельных запросов) и навигация вперёд снова окажется недоступной.
      const sprintsListRes = await sprintsApi.getList(companyId);

      if (signal?.aborted) return;

      const currentSprint = sprintRes.data;
      setSprint(currentSprint);
      setCurrentSprintId(currentRes.data.id);
      setAllSprints(sprintsListRes.data);
      setErrorTags(tagsRes.data);
      setCompanySettings(settingsRes.data);

      // Фактор разгонной недели для баров менеджеров (не блокирует доску; зоны команды — с бэка).
      sprintsApi.getTeamProgress(currentSprint.id)
        .then(r => { if (!signal?.aborted) setRampUpFactor(r.data.rampUpFactor ?? 1); })
        .catch(() => {});

      // Load entries
      const params = user?.role === 'manager'
        ? { sprintId: currentSprint.id, managerId: user.id }
        : { sprintId: currentSprint.id, companyId };

      const entriesRes = await entriesApi.getAll(params);
      if (signal?.aborted) return;
      setEntries(entriesRes.data);

      // РОП на пустом спринте: ищем ожидающие ревью записи в других спринтах
      if ((user?.role === 'reviewer' || user?.role === 'owner') && entriesRes.data.length === 0) {
        try {
          // PERF10: раньше тянули ВСЮ историю компании ради поиска ожидающих ревью —
          // явный status сужает выборку и не растёт с историей.
          const allRes = await entriesApi.getAll({ companyId, status: 'submitted' });
          const waiting = (allRes.data ?? []).filter(e => e.status === 'submitted' && e.sprintId !== currentSprint.id);
          if (!signal?.aborted && waiting.length > 0) {
            // Ведём в самый старый спринт с ожидающими записями
            setPendingElsewhere({ count: waiting.length, sprintId: waiting[0].sprintId });
          }
        } catch { /* не блокируем доску */ }
      } else {
        setPendingElsewhere(null);
      }
    } catch {
      if (!signal?.aborted) {
        setError('Не удалось загрузить спринт');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [companyId, user]);

  useEffect(() => {
    const controller = new AbortController();
    loadSprint(sprintId, controller.signal);
    return () => controller.abort();
  }, [sprintId, loadSprint]);

  // Переход «Добавить в текущую неделю» с закрытой недели идёт внутри этой же страницы,
  // без перемонтирования: начальное значение showAddForm уже посчитано, и форма осталась бы
  // закрытой вопреки надписи на кнопке. Держим состояние в согласии с адресом.
  useEffect(() => {
    if (actionParam === 'add') setShowAddForm(true);
  }, [actionParam, sprintId]);

  const handleNavigate = (id: string) => {
    navigate(`/sprint/${id}`);
  };

  const handleEntryUpdate = useCallback((updated: Entry) => {
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
  }, []);

  const handleEntryAdd = useCallback((newEntry: Entry) => {
    setEntries(prev => [...prev, newEntry]);
  }, []);

  const handleEntryDelete = useCallback((entryId: string) => {
    setEntries(prev => prev.filter(entry => entry.id !== entryId));
  }, []);

  const handleTagCreated = useCallback((tag: ErrorTag) => {
    setErrorTags(prev => [...prev, tag]);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card padding="md" className="animate-pulse">
          <div className="h-6 bg-border rounded-chip w-48 mb-3" />
          <div className="h-4 bg-surface-sunken rounded-chip w-32" />
        </Card>
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-canvas rounded-card p-5 animate-pulse space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-border" />
              <div className="h-4 bg-border rounded-chip w-32" />
            </div>
            <div className="h-2 bg-border rounded-full w-full" />
            {[1, 2].map(j => (
              <Card radius="block" key={j} padding="none" className="h-11 border-border" />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (error || !sprint) {
    // Superadmin with no company selected — выбор компании прямо здесь
    if (user?.role === 'superadmin' && !companyId) {
      return (
        <div className="space-y-6">
          <CompanyPicker
            title="Выберите компанию для просмотра доски спринта"
            subtitle="Разбор звонков и переписок ведётся в контексте конкретной компании клиента."
            onPick={id => setSearchParams({ companyId: id })}
          />
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="text-danger text-body">{error || 'Спринт не найден'}</div>
        {error && !error.includes('не выбрана') && (
          <Button variant="secondary" size="md"
            onClick={() => loadSprint(sprintId)}
          >
            Попробовать снова
          </Button>
        )}
      </div>
    );
  }

  // Sort sprints by date
  const sorted = [...allSprints].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const currentIdx = sorted.findIndex(s => s.id === sprint.id);
  const prevSprint = currentIdx > 0 ? sorted[currentIdx - 1] : null;
  const nextSprint = currentIdx < sorted.length - 1 ? sorted[currentIdx + 1] : null;

  // Group entries by manager
  const managersMap = new Map<string, { manager: User; entries: Entry[] }>();
  entries.forEach(entry => {
    if (!entry.manager) return;
    if (!managersMap.has(entry.managerId)) {
      managersMap.set(entry.managerId, { manager: entry.manager, entries: [] });
    }
    managersMap.get(entry.managerId)!.entries.push(entry);
  });

  // For manager role — show only self
  if (user?.role === 'manager' && !managersMap.has(user.id)) {
    managersMap.set(user.id, { manager: user as User, entries: [] });
  }

  const isReviewer = user?.role === 'reviewer' || user?.role === 'owner';

  // For reviewers: sort manager sections — most pending (submitted) entries first
  const managerSections = Array.from(managersMap.values())
    .filter(s => s.manager != null)
    .sort((a, b) => {
      if (!isReviewer) return 0;
      const pendingA = a.entries.filter(e => e.status === 'submitted').length;
      const pendingB = b.entries.filter(e => e.status === 'submitted').length;
      return pendingB - pendingA;
    });

  // Очередь ожидающих ревью в визуальном порядке доски — для кнопки «К следующей».
  const pendingIds = managerSections.flatMap(s => s.entries.filter(e => e.status === 'submitted').map(e => e.id));
  const nextPendingId = pendingIds.find(id => id !== focusEntryId) ?? pendingIds[0] ?? null;

  // Reviewer stats
  const totalEntries = entries.length;
  const submittedEntries = entries.filter(e => e.status === 'submitted').length;
  const reviewedEntries = entries.filter(e => e.status === 'reviewed').length;
  const completionPct = totalEntries > 0 ? Math.round(reviewedEntries / totalEntries * 100) : 0;

  return (
    <div className="space-y-6">
      {user?.role === 'superadmin' && companyIdParam && (
        <Button
          type="button"
          onClick={() => navigate(`/admin/company/${companyIdParam}`)}
          variant="link"
          size="sm"
          icon={<ArrowLeft />}
        >
          Карточка компании
        </Button>
      )}
      <SprintHeader
        sprint={sprint}
        prevSprint={prevSprint}
        nextSprint={nextSprint}
        onNavigate={handleNavigate}
        companyName={companyName || undefined}
        onGoCurrent={currentSprintId && currentSprintId !== sprint.id ? () => handleNavigate(currentSprintId) : undefined}
      />

      {/* Reviewer stats + прогресс РОПа */}
      {isReviewer && totalEntries > 0 && (() => {
        const toReview = submittedEntries + reviewedEntries; // всё что пришло на ревью
        const ropPct = toReview > 0 ? Math.round(reviewedEntries / toReview * 100) : 0;
        const ropBarColor = ropPct === 100 ? 'var(--color-success)' : ropPct >= 50 ? 'var(--color-accent)' : 'var(--color-danger)';
        return (
          <Card padding="sm" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4 text-center sm:divide-x divide-border">
              <div>
                <div className="text-section font-bold text-fg">{totalEntries}</div>
                <div className="text-micro text-fg-subtle mt-0.5">Всего</div>
              </div>
              <div>
                <div className="text-section font-bold text-accent">{submittedEntries}</div>
                <div className="text-micro text-fg-subtle mt-0.5">Ждут ревью</div>
              </div>
              <div>
                <div className="text-section font-bold text-success-fg">{reviewedEntries}</div>
                <div className="text-micro text-fg-subtle mt-0.5">Проверено</div>
              </div>
              <div>
                <div className={cn('text-section font-bold', completionPct === 100 ? 'text-success-fg' : 'text-fg')}>
                  {completionPct}%
                </div>
                <div className="text-micro text-fg-subtle mt-0.5">Готовность</div>
              </div>
            </div>
            {/* Прогресс-бар РОПа */}
            {toReview > 0 && (
              <div className="pt-2 border-t border-border">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-micro font-medium text-fg-muted">Ваш прогресс ревью</span>
                  <span className="text-micro font-semibold" style={{ color: ropBarColor }}>
                    {reviewedEntries} / {toReview} проверено
                  </span>
                </div>
                <div className="h-2 bg-surface-sunken rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${ropPct}%`, backgroundColor: ropBarColor }}
                  />
                </div>
              </div>
            )}
            {/* Поток разбора: прыжок к следующей ожидающей записи, чтобы не искать её в списке */}
            {submittedEntries > 0 && nextPendingId && (
              <Button
                type="button"
                onClick={() => setFocusEntryId(nextPendingId)}
                fullWidth
              >
                К следующей на ревью ({submittedEntries}) →
              </Button>
            )}
          </Card>
        );
      })()}

      {/* Пустой спринт у РОПа — объяснение и путь к ожидающим записям вместо белого экрана */}
      {isReviewer && totalEntries === 0 && (
        <Card padding="lg" className="text-center">
          <p className="text-fg-muted font-medium">В этом спринте записей пока нет</p>
          <p className="text-fg-subtle text-body mt-1">
            Менеджеры добавляют звонки и переписки в течение недели. Когда появится запись со статусом
            «Ждёт ревью», вы получите уведомление в колокольчике.
          </p>
          {pendingElsewhere && (
            <div className="mt-4">
              <Button
                type="button"
                onClick={() => navigate(`/sprint/${pendingElsewhere.sprintId}`)}
              >
                Открыть {pendingElsewhere.count} {pendingElsewhere.count === 1 ? 'запись, ждущую' : pendingElsewhere.count < 5 ? 'записи, ждущие' : 'записей, ждущих'} ревью →
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Team progress — reviewer/owner видят у всех, менеджер видит сводку (без содержимого чужих записей) */}
      <TeamProgressBar sprintId={sprint.id} />

      {managerSections.map(({ manager, entries: mEntries }) => (
        <ManagerSection
          key={manager.id}
          manager={manager}
          entries={mEntries}
          sprint={sprint}
          availableTags={errorTags}
          onEntryUpdate={handleEntryUpdate}
          onEntryAdd={handleEntryAdd}
          onEntryDelete={handleEntryDelete}
          onTagCreated={handleTagCreated}
          showAddForm={user?.id === manager.id && showAddForm ? true : undefined}
          defaultAddType={typeParam}
          onAddFormClose={() => setShowAddForm(false)}
          companySettings={companySettings}
          autoOpenEntryId={focusEntryId ?? entryIdParam}
          rampUpFactor={rampUpFactor}
        />
      ))}
    </div>
  );
}
