import { useState, useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Copy, Check, ChevronDown } from 'lucide-react';
import { formatTagName } from '@/lib/utils';
import { entriesApi } from '@/api/entries';
import { errorTagsApi } from '@/api/error-tags';
import { reviewTemplatesApi } from '@/api/review-templates';
import type { Entry, ErrorTag, ReviewTemplate, ManagerRepeat } from '@/types';
import { CharCounter } from './CharCounter';
import { Button, Chip, Input, Textarea, Notice, Card } from '@chirkov/shell';

interface ReviewerFormProps {
  entry: Entry;
  availableTags: ErrorTag[];
  onUpdate: (entry: Entry) => void;
  onTagCreated?: (tag: ErrorTag) => void;
  minReviewChars?: number;
  companyId?: string;
}

export function ReviewerForm({ entry, availableTags, onUpdate, onTagCreated, minReviewChars, companyId }: ReviewerFormProps) {
  const [reviewText, setReviewText] = useState(entry.reviewText ?? '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(entry.errorTags.map(t => t.id));
  const [loading, setLoading] = useState(false);
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [savedAt, setSavedAt] = useState<Date | null>(
    entry.reviewedAt ? new Date(entry.reviewedAt) : null
  );
  const [copied, setCopied] = useState(false);
  const [showNoTagsWarning, setShowNoTagsWarning] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<ReviewTemplate | null>(null);
  const initialReviewText = useRef(entry.reviewText ?? '');
  // Шаблоны из API (загружаем один раз при монтировании)
  const [templates, setTemplates] = useState<ReviewTemplate[]>([]);
  const [repeats, setRepeats] = useState<ManagerRepeat[]>([]);
  const effectiveCompanyId = companyId ?? entry.companyId;
  const repeatByTag = new Map(repeats.map(r => [r.tagId, r]));
  // В сводку идут ошибки, встреченные хотя бы дважды: один прошлый случай это ещё не привычка.
  const recurring = repeats.filter(r => r.count >= 2);

  // Загружаем шаблоны ревью из API
  useEffect(() => {
    if (!effectiveCompanyId) return;
    reviewTemplatesApi.getAll(effectiveCompanyId)
      .then(({ data }) => setTemplates(data))
      .catch(() => {}); // не блокируем UI если не загрузились
  }, [effectiveCompanyId]);

  // Повторы ошибок этого менеджера: руководитель видит, что уже говорил, и сколько раз.
  useEffect(() => {
    entriesApi.repeats(entry.id)
      .then(({ data }) => setRepeats(data ?? []))
      .catch(() => setRepeats([])); // сводка не критична, разбор писать не мешаем
  }, [entry.id]);

  // Sync state when entry changes (e.g. switching between entries)
  useEffect(() => {
    setReviewText(entry.reviewText ?? '');
    setSelectedTagIds(entry.errorTags.map(t => t.id));
    setSavedAt(entry.reviewedAt ? new Date(entry.reviewedAt) : null);
    initialReviewText.current = entry.reviewText ?? '';
  }, [entry.id]); // only re-sync when entry ID changes

  const minChars = minReviewChars ?? 150;
  const canReview = reviewText.trim().length >= minChars;
  const isDirty = reviewText !== initialReviewText.current;
  // Разбор уже сохранён: РОП его уточняет, а не пишет заново.
  const isEdit = entry.status === 'reviewed';

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Ctrl+Enter to submit
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canReview && !loading) {
      e.preventDefault();
      handleSubmit();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReview, loading, reviewText, selectedTagIds]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleCopyReview = async () => {
    if (!reviewText.trim()) return;
    try {
      await navigator.clipboard.writeText(reviewText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать', { duration: Infinity });
    }
  };

  const toggleTag = (tagId: string) => {
    setShowNoTagsWarning(false);
    setSelectedTagIds(prev =>
      prev.includes(tagId) ? prev.filter(id => id !== tagId) : [...prev, tagId]
    );
  };

  const handleSubmit = async () => {
    if (!canReview) return;

    if (selectedTagIds.length === 0 && !showNoTagsWarning) {
      setShowNoTagsWarning(true);
      return;
    }
    setShowNoTagsWarning(false);

    setLoading(true);
    try {
      const { data } = await entriesApi.review(entry.id, { reviewText, tagIds: selectedTagIds });
      onUpdate(data);
      setSavedAt(data.reviewedAt ? new Date(data.reviewedAt) : new Date());
      initialReviewText.current = reviewText; // reset dirty state
      toast.success(isEdit ? 'Разбор обновлён' : 'Ревью сохранено');
    } catch {
      toast.error('Не удалось сохранить ревью. Текст остался в форме. Проверьте соединение и нажмите «Сохранить» ещё раз', { duration: Infinity });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const { data: newTag } = await errorTagsApi.create({
        name: newTagName.trim(),
        color: 'var(--color-accent)',
        companyId: entry.companyId,
      });
      setSelectedTagIds(prev => [...prev, newTag.id]);
      onTagCreated?.(newTag);
      setNewTagName('');
      setShowNewTagForm(false);
    } catch {
      toast.error('Не удалось создать тег', { duration: Infinity });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-body font-medium text-fg-muted">Ревью</label>
          <div className="flex items-center gap-3">
            {/* Templates dropdown — видим только если backend вернул шаблоны.
                Для reviewer'а без флага reviewerCanEditReviewTemplates список пустой → dropdown скрыт. */}
            {templates.length > 0 && <div className="relative">
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowTemplates(v => !v)}
                aria-label="Выбрать шаблон ревью"
                aria-haspopup="true"
                aria-expanded={showTemplates}
               iconRight={<ChevronDown />}>
                Шаблоны
</Button>
              {showTemplates && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowTemplates(false)} />
                  <Card padding="none" radius="block" className="absolute right-0 top-5 z-20 shadow-raised w-64 text-left">
                    <div className="py-1">
                      {templates.length === 0 && (
                        <p className="px-3 py-2 text-micro text-fg-subtle">Нет шаблонов</p>
                      )}
                      {templates.map(tpl => (
                        <Button
                          key={tpl.id}
                          type="button"
                          variant="ghost"
                          size="sm"
                          fullWidth
                          onClick={() => {
                            if (reviewText.trim().length > 0) {
                              setPendingTemplate(tpl);
                              setShowTemplates(false);
                            } else {
                              setReviewText(tpl.content);
                              setShowTemplates(false);
                            }
                          }}
                        >
                          {tpl.name}
                        </Button>
                      ))}
                    </div>
                  </Card>
                </>
              )}
            </div>}
            {reviewText.trim().length > 0 && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handleCopyReview}
                title="Скопировать ревью"
                icon={copied ? <Check className="text-success" /> : <Copy />}
              >
                {copied ? 'Скопировано' : 'Копировать'}
              </Button>
            )}
          </div>
        </div>
        <p className="text-micro text-fg-subtle mb-1.5">Структура ревью: что сделано не так и почему это важно · как влияет на результат продажи · что попробовать в следующий раз</p>
        <Textarea resize="none"
          value={reviewText}
          onChange={e => setReviewText(e.target.value)}
          placeholder="Напишите ревью по структуре выше…"
          rows={6}
        />
        <CharCounter value={reviewText} min={minChars} />
      </div>

      {pendingTemplate && (
        <Notice tone="warning" title={`Заменить текст шаблоном «${pendingTemplate.name}»?`}>
          <p>Текущий черновик будет утерян.</p>
          <div className="flex gap-2 mt-2">
            <div className="flex-1">
              <Button type="button" variant="primary" size="sm" fullWidth onClick={() => { setReviewText(pendingTemplate.content); setPendingTemplate(null); }}>Заменить</Button>
            </div>
            <div className="flex-1">
              <Button type="button" variant="secondary" size="sm" fullWidth onClick={() => setPendingTemplate(null)}>Отмена</Button>
            </div>
          </div>
        </Notice>
      )}

      <div>
        <label className="block text-body font-medium text-fg-muted mb-2">Теги ошибок</label>

        {/* Что у этого человека повторяется. Отвечает на вопрос руководителя «применили ли они
            то, что я уже говорил»: если ошибка идёт третий раз, обратная связь не работает. */}
        {recurring.length > 0 && (
          <Notice tone="warning" title={`У ${entry.manager?.fullName ?? 'менеджера'} это повторяется за последние 6 недель`}>
            <ul className="space-y-1">
              {recurring.slice(0, 4).map(r => (
                <li key={r.tagId} className="flex flex-wrap items-baseline gap-x-1.5">
                  <span className="font-medium">{formatTagName(r.tagName)}</span>
                  <span>
                    {r.count} {r.count < 5 ? 'раза' : 'раз'}
                  </span>
                  <span>
                    (записи {r.lastEntries.map(e => `№${e.entryNumber}`).join(', ')})
                  </span>
                </li>
              ))}
            </ul>
          </Notice>
        )}

        {/* Toggle pills — selected tags are highlighted */}
        <div className="flex flex-wrap gap-x-2 gap-y-3">
          {availableTags.map(tag => {
            const isSelected = selectedTagIds.includes(tag.id);
            const repeat = repeatByTag.get(tag.id);
            return (
              <Chip
                key={tag.id}
                pressed={isSelected}
                onPressedChange={() => toggleTag(tag.id)}
                tone={repeat ? 'warning' : 'neutral'}
                count={repeat ? repeat.count + (isSelected ? 1 : 0) : undefined}
                title={repeat ? `Раньше отмечалось ${repeat.count} раз за 6 недель` : undefined}
              >
                {formatTagName(tag.name)}
              </Chip>
            );
          })}
        </div>

        {/* Inline new tag form */}
        <div className="mt-5 mb-3">
          {showNewTagForm ? (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  value={newTagName}
                  onChange={e => setNewTagName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTag()}
                  placeholder="Название тега..."
                  autoFocus
                />
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleCreateTag}
                disabled={!newTagName.trim()}
              >
                Создать тег
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { setShowNewTagForm(false); setNewTagName(''); }}
              >
                Отмена
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setShowNewTagForm(true)}
            >
              + Новый тег
            </Button>
          )}
        </div>
      </div>

      {showNoTagsWarning && (
        <Notice
          tone="warning"
          title="Теги не выбраны"
          action={<Button type="button" variant="ghost" size="sm" onClick={() => setShowNoTagsWarning(false)}>Скрыть</Button>}
        >
          <p>Без тегов аналитика будет неполной. Нажмите «Сохранить» ещё раз, чтобы всё равно отправить.</p>
        </Notice>
      )}

      <Button
        type="button"
        variant="primary"
        size="md"
        fullWidth
        onClick={handleSubmit}
        disabled={!canReview || loading}
      >
        {loading ? 'Сохраняем…' : (
        <span className="flex items-center justify-center gap-2">
          {isEdit ? 'Обновить разбор' : 'Сохранить ревью'}
          {canReview && <span className="text-micro opacity-60 hidden md:inline">Ctrl+Enter</span>}
        </span>
      )}
      </Button>

      {savedAt && (() => {
        const isToday = savedAt.toDateString() === new Date().toDateString();
        const timeStr = savedAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        const dateStr = isToday ? '' : savedAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ' ';
        return (
          <p className="text-micro text-success-fg text-center" aria-live="polite">
            ✓ Сохранено {dateStr}в {timeStr}
          </p>
        );
      })()}
    </div>
  );
}
