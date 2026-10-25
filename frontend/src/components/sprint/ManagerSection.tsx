import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import type { Entry, ErrorTag, User, Sprint, CompanySettings } from '@/types';
import { ProgressIndicator } from './ProgressIndicator';
import { EntryCard } from './EntryCard';
import { AddEntryForm } from './AddEntryForm';
import { useAuthStore } from '@/stores/authStore';
import { Avatar, Button, EmptyState } from '@chirkov/shell';

interface ManagerSectionProps {
  manager: User;
  entries: Entry[];
  sprint: Sprint;
  availableTags: ErrorTag[];
  onEntryUpdate: (entry: Entry) => void;
  onEntryAdd: (entry: Entry) => void;
  onEntryDelete: (entryId: string) => void;
  onTagCreated?: (tag: ErrorTag) => void;
  defaultAddType?: 'call' | 'chat' | null;
  showAddForm?: boolean;
  onAddFormClose?: () => void;
  companySettings?: CompanySettings | null;
  autoOpenEntryId?: string | null;
  rampUpFactor?: number;
}

export function ManagerSection({
  manager, entries, sprint, availableTags,
  onEntryUpdate, onEntryAdd, onEntryDelete, onTagCreated,
  defaultAddType, showAddForm: externalShowAddForm, onAddFormClose,
  companySettings, autoOpenEntryId, rampUpFactor,
}: ManagerSectionProps) {
  const [internalShowAddForm, setInternalShowAddForm] = useState(false);
  const [addType, setAddType] = useState<'call' | 'chat'>('call');
  const [lastAddedId, setLastAddedId] = useState<string | null>(null);
  const currentUser = useAuthStore(s => s.user);
  const navigate = useNavigate();

  const showAddForm = externalShowAddForm ?? internalShowAddForm;
  // Создание записи бэкенд разрешает только в активном спринте (entries.service.ts).
  const sprintIsActive = sprint.status === 'active';

  const callsEnabled = companySettings?.callsEnabled ?? true;
  const chatsEnabled = companySettings?.chatsEnabled ?? true;
  const isReviewer = currentUser?.role === 'reviewer' || currentUser?.role === 'owner' || currentUser?.role === 'superadmin';

  const handleAddClick = (type: 'call' | 'chat') => {
    setAddType(type);
    setInternalShowAddForm(true);
  };

  const handleFormClose = () => {
    setInternalShowAddForm(false);
    onAddFormClose?.();
  };

  const handleEntryAdded = (entry: Entry) => {
    // Backend create() не возвращает relations — подставляем дефолты
    const safeEntry: Entry = {
      ...entry,
      manager: entry.manager ?? manager,
      errorTags: entry.errorTags ?? [],
      screenshots: entry.screenshots ?? [],
    };
    setLastAddedId(safeEntry.id); // авто-открыть карточку для самоанализа
    onEntryAdd(safeEntry);
    handleFormClose();
  };

  // Для РОПа: сначала "ждут ревью" (submitted), потом черновики, потом проверенные
  const sortedEntries = isReviewer
    ? [...entries].sort((a, b) => {
        const order = { submitted: 0, draft: 1, reviewed: 2 };
        return (order[a.status as keyof typeof order] ?? 3) - (order[b.status as keyof typeof order] ?? 3);
      })
    : entries;

  const reviewed = entries.filter(e => e.status === 'reviewed').length;
  const submitted = entries.filter(e => e.status === 'submitted').length;

  return (
    <div className="bg-canvas rounded-card p-5 space-y-4">
      {/* Manager header */}
      <div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
          {/* Use Avatar component to respect user's color */}
          <Avatar name={manager.fullName} color={manager.color ?? undefined} size="md" />
          {/* Имя переносится, а не обрезается: на 320 точках у Inter оно
             перестало помещаться в строку, и заголовок раздела показывал
             сотруднику его же имя обрезанным. */}
          <span className="font-semibold text-fg">{manager.fullName}</span>
          {entries.length > 0 && (
            <span className="text-micro text-fg-subtle flex-shrink-0">
              {reviewed}/{entries.length} проверено
              {submitted > 0 && (
                <span className="ml-1 font-medium text-accent">
                  · {submitted} ждут
                </span>
              )}
            </span>
          )}
        </div>

        {/* Progress bars — full width */}
        <ProgressIndicator
          entries={entries}
          settings={companySettings}
          callTarget={companySettings?.callsPerWeek ?? 5}
          chatTarget={companySettings?.chatsPerWeek ?? 5}
          callsEnabled={callsEnabled}
          chatsEnabled={chatsEnabled}
          rampUpFactor={rampUpFactor}
          showRampUpNote={!isReviewer}
        />

        {/* Закрытая неделя: сервер не примет запись, поэтому кнопок нет и человек
            сразу видит, куда идти. Раньше форма открывалась, файл загружался,
            а создание падало 400 уже после всей проделанной работы. */}
        {!isReviewer && !sprintIsActive && (
          <div className="flex flex-wrap items-center gap-2 mt-3 text-micro text-fg-subtle">
            <span>Эта неделя закрыта, разборы в неё больше не добавляются.</span>
            <Button type="button" variant="secondary" size="sm"
              onClick={() => navigate('/sprint?action=add&type=call')}
            >
              Добавить в текущую неделю
            </Button>
          </div>
        )}

        {/* Add buttons — ПОД прогресс-барами, только для менеджера */}
        {!showAddForm && !isReviewer && sprintIsActive && (
          <div className="flex items-center gap-2 mt-3 mb-3">
            {callsEnabled && (
              <Button type="button" onClick={() => handleAddClick('call')} variant="secondary" size="sm">
                Добавить звонок
              </Button>
            )}
            {chatsEnabled && (
              <Button type="button" onClick={() => handleAddClick('chat')} variant="secondary" size="sm">
                Добавить переписку
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Add form. Закрытая неделя не пускает даже по прямой ссылке ?action=add:
          иначе человек снова заполнит форму ради отказа сервера. */}
      {showAddForm && sprintIsActive && (
        <AddEntryForm
          sprintId={sprint.id}
          managerId={manager.id}
          companyId={sprint.companyId}
          defaultType={defaultAddType ?? addType}
          existingEntries={entries}
          onSuccess={handleEntryAdded}
          onCancel={handleFormClose}
          companySettings={companySettings}
        />
      )}

      {/* Empty state — только когда нет записей И форма не открыта */}
      {entries.length === 0 && !showAddForm && (
        <EmptyState
          icon={Target}
          title={isReviewer ? 'Записей пока нет' : sprintIsActive ? 'Начните свой первый разбор' : 'В этой неделе разборов не было'}
          description={
            isReviewer
              ? 'Менеджер ещё не добавил звонки или переписки в этом спринте'
              : sprintIsActive
                ? 'Загрузите звонок или переписку: РОП разберёт и подскажет, что улучшить'
                : 'Неделя закрыта. Новый разбор добавляется в текущую неделю, кнопка выше.'
          }
          action={
            !isReviewer && sprintIsActive ? (
              <p className="text-micro text-fg-subtle">Среднее время разбора: 15 минут</p>
            ) : undefined
          }
        />
      )}

      {/* Entries — рендерятся только при наличии записей */}
      {entries.length > 0 && (
        <div className="space-y-3">
          {sortedEntries.map(entry => (
            <EntryCard
              key={entry.id}
              entry={entry}
              availableTags={availableTags}
              onUpdate={onEntryUpdate}
              onDelete={onEntryDelete}
              onTagCreated={onTagCreated}
              companySettings={companySettings}
              defaultExpanded={entry.id === lastAddedId || entry.id === autoOpenEntryId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
