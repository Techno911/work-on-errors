import { useState, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Tag, Share2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatTagName } from '@/lib/utils';
import type { Entry, ErrorTag, CompanySettings } from '@/types';
import { EntryStatusBadge } from './EntryStatusBadge';
import { ErrorTagPill } from './ErrorTagPill';
import { TranscriptionView } from './TranscriptionView';
import { TranscriptionStatusBadge } from './TranscriptionStatusBadge';
import { ScreenshotGallery } from './ScreenshotGallery';
import { SelfReviewForm } from './SelfReviewForm';
import { ReviewerForm } from './ReviewerForm';
import { ReviewConfirmBlock } from './ReviewConfirmBlock';
import { useAuthStore } from '@/stores/authStore';
import { shareApi } from '@/api/share';
import { API_BASE_URL } from '@/api/client';
import { Button, Modal, Card } from '@chirkov/shell';
import { ColorTagBadge } from '@/components/ui/badge';
import { entriesApi } from '@/api/entries';

const STATUS_BAR = {
  draft: 'bg-border-strong',
  submitted: 'bg-accent',
  reviewed: 'bg-success-fg',
} as const;

interface EntryCardProps {
  entry: Entry;
  availableTags: ErrorTag[];
  onUpdate: (entry: Entry) => void;
  onDelete?: (entryId: string) => void;
  onTagCreated?: (tag: ErrorTag) => void;
  defaultExpanded?: boolean;
  companySettings?: CompanySettings | null;
}

export function EntryCard({ entry, availableTags, onUpdate, onDelete, onTagCreated, defaultExpanded = false, companySettings }: EntryCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [sharing, setSharing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const user = useAuthStore(s => s.user);
  const cardRef = useRef<HTMLDivElement>(null);

  const handleShare = async () => {
    setSharing(true);
    try {
      const { data } = await shareApi.createEntryLink(entry.id);
      const apiOrigin = API_BASE_URL.replace(/\/api\/?$/, '');
      const link = `${apiOrigin}/api/share/entry?token=${encodeURIComponent(data.token)}`;
      try {
        await navigator.clipboard.writeText(link);
        toast.success('Ссылка на разбор скопирована! Действует 30 дней.');
      } catch {
        // Если clipboard недоступен — открываем в новой вкладке
        window.open(link, '_blank');
        toast.success('Ссылка на разбор открыта в новой вкладке');
      }
    } catch {
      toast.error('Не удалось создать ссылку', { duration: Infinity });
    } finally {
      setSharing(false);
    }
  };

  // Sync with defaultExpanded prop changes (e.g. клик по очереди / уведомлению / «К следующей»)
  useEffect(() => {
    if (defaultExpanded) {
      setExpanded(true);
      // Прокрутку откладываем: раскрытый контент сначала должен увеличить высоту
      // карточки, иначе scrollIntoView уводит к её старой (свёрнутой) позиции.
      const t = setTimeout(() => {
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      return () => clearTimeout(t);
    }
  }, [defaultExpanded]);

  // Авто-сворачивание после ревью (submitted → reviewed) и самоанализа (draft → submitted)
  const handleUpdate = useCallback((updated: Entry) => {
    if (updated.status === 'reviewed' && entry.status !== 'reviewed') {
      setExpanded(false);
    }
    if (updated.status === 'submitted' && entry.status === 'draft') {
      setExpanded(false);
    }
    onUpdate(updated);
  }, [entry.status, onUpdate]);
  const isReviewer = user?.role === 'reviewer' || user?.role === 'owner' || user?.role === 'superadmin';
  const canDeleteDraft = isReviewer && entry.status === 'draft' && !!onDelete;

  const handleDeleteDraft = async () => {
    setDeleting(true);
    try {
      await entriesApi.delete(entry.id);
      onDelete?.(entry.id);
      setDeleteConfirmOpen(false);
      toast.success('Черновик удалён');
    } catch (error) {
      const message = (error as { response?: { data?: { message?: string } } })
        .response?.data?.message;
      toast.error(message ?? 'Не удалось удалить черновик', { duration: Infinity });
    } finally {
      setDeleting(false);
    }
  };

  const typeLabel = entry.type === 'call' ? '📞 Звонок' : '💬 Переписка';
  const entryTitle = `${typeLabel} #${entry.entryNumber} · ${new Date(entry.entryDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}`;
  // Оранжевая плашка «Ждёт ревью →» уже сообщает и статус, и действие — второй раз
  // дублировать его обычным бейджем не нужно (на телефоне это разгружает шапку).
  const showReviewerNudge = isReviewer && entry.status === 'submitted' && !expanded;

  return (
    <>
      <Card
        ref={cardRef}
        padding="none"
        radius="block"
        elevation="raised"
        className="relative overflow-hidden scroll-mt-4"
      >
      {/* Статусная полоса слева: border-color у пакетного Card закрыт, поэтому полоса отдельным элементом. */}
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0 w-1', STATUS_BAR[entry.status])} />
      {/* Header */}
      <Button
        variant="ghost"
        size="md"
        fullWidth
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? `Свернуть: ${entryTitle}` : `Раскрыть: ${entryTitle}`}
      >
        <span className="flex items-center justify-between w-full py-2 text-left font-normal">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:gap-x-3 min-w-0 flex-1">
          {/* Шеврон и название держатся вместе: на узком экране переносятся статус и теги, а не название. */}
          <span className="flex items-center gap-2 min-w-0 max-w-full">
            {expanded ? <ChevronDown className="w-4 h-4 text-fg-disabled flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-fg-disabled flex-shrink-0" />}
            <span className="text-body font-medium text-fg min-w-0">{entryTitle}</span>
          </span>
          {entry.source && !expanded && (
            <span className="hidden sm:inline text-micro text-fg-subtle flex-shrink-0">· {entry.source}</span>
          )}
          {!showReviewerNudge && <span className="flex-shrink-0"><EntryStatusBadge status={entry.status} /></span>}
          {!showReviewerNudge && entry.status === 'submitted' && !expanded && (
            <span className="w-2 h-2 rounded-full bg-accent-focus animate-pulse flex-shrink-0" aria-hidden="true" />
          )}
          {(entry.errorTags?.length ?? 0) > 0 && entry.status === 'reviewed' ? (
            <div className="flex items-center gap-1 flex-wrap min-w-0">
              {entry.errorTags.slice(0, 3).map(tag => (
                <ColorTagBadge key={tag.id} color={tag.color}>
                  {formatTagName(tag.name)}
                </ColorTagBadge>
              ))}
              {entry.errorTags.length > 3 && (
                <span className="text-micro text-fg-subtle">+{entry.errorTags.length - 3}</span>
              )}
            </div>
          ) : (entry.errorTags?.length ?? 0) > 0 ? (
            <span className="flex items-center gap-1 text-micro text-fg-subtle">
              <Tag className="w-3 h-3" /> {entry.errorTags.length}
            </span>
          ) : null}
        </span>
        {/* Right side: reviewer "needs action" nudge */}
        {isReviewer && entry.status === 'submitted' && !expanded && (
          <span className="flex-shrink-0 text-micro font-medium text-accent-hover bg-accent-subtle px-2.5 py-1 rounded-card mr-3">
            Ждёт ревью →
          </span>
        )}
        </span>
      </Button>

      {/* Expanded content — 3 columns */}
      {expanded && (
        <div className="border-t border-border">
          <div className="grid grid-cols-1 lg:grid-cols-3 divide-border lg:divide-x">
            {/* Column 1: Dialog */}
            <div className="p-4 pb-5 space-y-3 border-b border-border lg:border-b-0">
              <h4 className="text-micro font-semibold text-fg-subtle tracking-overline">Диалог</h4>
              {entry.type === 'call' ? (
                <>
                  <TranscriptionStatusBadge entry={entry} onUpdate={handleUpdate} />
                  {entry.transcription
                    ? <TranscriptionView text={entry.transcription} />
                    : <p className="text-body text-fg-subtle italic">
                        {isReviewer ? 'Текст разговора пока недоступен' : 'Транскрипция не добавлена'}
                      </p>}
                </>
              ) : (
                // Переписка приходит скриншотами или текстом (менеджер выбирает сам при
                // создании). Показываем то, что есть: у одной записи может быть и то и другое.
                <>
                  {entry.transcription && <TranscriptionView text={entry.transcription} />}
                  {(entry.screenshots?.length ?? 0) > 0 && (
                    <ScreenshotGallery entryId={entry.id} screenshots={entry.screenshots} />
                  )}
                  {!entry.transcription && (entry.screenshots?.length ?? 0) === 0 && (
                    <p className="text-body text-fg-subtle italic">Диалог не добавлен</p>
                  )}
                </>
              )}
            </div>

            {/* Column 2: Self-review */}
            <div className="p-4 pb-5 border-b border-border lg:border-b-0">
              <h4 className="text-micro font-semibold text-fg-subtle tracking-overline mb-3">Самоанализ</h4>
              <SelfReviewForm entry={entry} onUpdate={handleUpdate} settings={companySettings} />
            </div>

            {/* Column 3: Feedback */}
            <div className="p-4 pb-5 space-y-3">
              <h4 className="text-micro font-semibold text-fg-subtle tracking-overline">Обратная связь</h4>

              {/* Reviewer form */}
              {isReviewer && entry.status !== 'draft' && (
                <ReviewerForm
                  entry={entry}
                  availableTags={availableTags}
                  onUpdate={handleUpdate}
                  onTagCreated={onTagCreated}
                  minReviewChars={companySettings?.minReviewChars}
                  companyId={entry.companyId}
                />
              )}

              {/* Read-only review */}
              {!isReviewer && entry.status === 'reviewed' && entry.reviewText && (
                <div className="space-y-3">
                  <p className="text-body text-fg-muted whitespace-pre-line">{entry.reviewText}</p>
                  {(entry.errorTags?.length ?? 0) > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border">
                      {(entry.errorTags ?? []).map(tag => <ErrorTagPill key={tag.id} tag={tag} />)}
                    </div>
                  )}
                </div>
              )}

              {/* Личная отметка чтения разбора: действие у менеджера-автора,
                  состояние видно и РОПу/владельцу (кнопки у них нет) */}
              {entry.status === 'reviewed' && entry.reviewText && (
                <ReviewConfirmBlock entry={entry} onUpdate={handleUpdate} />
              )}

              {/* Share button (reviewed entries) */}
              {entry.status === 'reviewed' && (
                <div className="mt-3">
                  <Button variant="secondary" size="sm" fullWidth
                    onClick={handleShare}
                    disabled={sharing}
                    icon={<Share2 />}
                  >
                    {sharing ? 'Создаём ссылку...' : 'Поделиться разбором'}
                  </Button>
                </div>
              )}

              {/* Waiting states */}
              {!isReviewer && entry.status === 'draft' && (
                <div className="px-3 py-4 text-center text-body text-fg-subtle bg-canvas rounded-block">
                  Сначала заполните самоанализ и отправьте на ревью
                </div>
              )}
              {!isReviewer && entry.status === 'submitted' && (
                <div className="py-4 text-center text-body text-accent-hover bg-accent-subtle rounded-block border border-accent-muted">
                  ⏳ Ждём обратную связь от РОПа
                </div>
              )}

              {isReviewer && entry.status === 'draft' && (
                <div className="space-y-3">
                  <div className="px-3 py-4 text-center text-body text-fg-subtle bg-canvas rounded-block">
                    Менеджер ещё не отправил самоанализ
                  </div>
                  {canDeleteDraft && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      fullWidth
                      onClick={() => setDeleteConfirmOpen(true)}
                      icon={<Trash2 aria-hidden="true" />}
                    >
                      Удалить черновик
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
      <Modal
        open={deleteConfirmOpen}
        onClose={() => { if (!deleting) setDeleteConfirmOpen(false); }}
        title="Удалить черновик?"
        closeOnBackdrop={!deleting}
        closeOnEscape={!deleting}
        footer={(
          <>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={deleting}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="danger"
              size="md"
              onClick={handleDeleteDraft}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Удаляем…' : 'Удалить черновик'}
            </Button>
          </>
        )}
      >
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger-subtle flex items-center justify-center">
            <Trash2 className="w-5 h-5 text-danger-fg" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-body text-fg-muted">
              Черновик «{entryTitle}» менеджера <strong className="text-fg">{entry.manager?.fullName ?? 'без указанного имени'}</strong> исчезнет из доски. Вернуть его через платформу не получится.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
