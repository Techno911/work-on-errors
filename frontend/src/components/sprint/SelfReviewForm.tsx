import { useState, useCallback, useRef, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { HelpCircle, Check, AlertTriangle, ThumbsUp, Wrench, Lightbulb } from 'lucide-react';
import { entriesApi } from '@/api/entries';
import { useAuthStore } from '@/stores/authStore';
import type { Entry, CompanySettings } from '@/types';
import { CharCounter } from './CharCounter';
import { Button, Textarea, Card } from '@chirkov/shell';

// Inline-примеры из «Стандарта работы над ошибками 1.9»
const EXAMPLES = {
  correct: 'Поздоровался, назвал имя, уточнил откуда узнал о нас. Подробно ответил на вопрос о процедуре.',
  improve: 'Когда клиент сказал «я подумаю», просто попрощался. Не спросил, что вызывает сомнения. Не предложил альтернативу.',
  suggestions: 'При «я подумаю» задавать вопрос: «Что именно хотели бы обдумать?»',
};

function ExampleHint({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Поповер выносим в портал на body: внутри карточки с overflow-hidden
  // на телефоне его обрезало. Позицию считаем от кнопки и прижимаем к краям экрана.
  // Ref держим на обёртке-span: пакетный Button не forwardRef, ref на него не типизирован.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const margin = 12;
    const width = Math.min(288, window.innerWidth - margin * 2);
    let left = r.left;
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width;
    if (left < margin) left = margin;
    setPos({ top: r.bottom + 6, left, width });
  }, [open]);

  return (
    <span className="inline-block" ref={btnRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(v => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-label="Показать пример"
        title="Пример из стандарта"
        icon={<HelpCircle />}
      />
      {open && pos && createPortal(
        <div data-ds-exception="позиция плашки считается от кнопки в px" className="fixed z-50" style={{ top: pos.top, left: pos.left, width: pos.width }} /* ds-исключение: позиция плашки считается от кнопки в пикселях, у пакетного Card нет style, положение несёт обёртка */>
          <Card padding="sm" radius="block" className="shadow-raised">
            <div className="text-micro text-fg-muted">
              <div className="font-semibold text-fg-subtle mb-1 text-micro tracking-overline">Пример</div>
              {text}
            </div>
          </Card>
        </div>,
        document.body
      )}
    </span>
  );
}

interface SelfReviewFormProps {
  entry: Entry;
  onUpdate: (entry: Entry) => void;
  settings?: CompanySettings | null;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function SelfReviewForm({ entry, onUpdate, settings }: SelfReviewFormProps) {
  const user = useAuthStore(s => s.user);
  const isManager = user?.role === 'manager';

  const [correct, setCorrect] = useState(entry.selfReviewCorrect ?? '');
  const [improve, setImprove] = useState(entry.selfReviewImprove ?? '');
  const [suggestions, setSuggestions] = useState(entry.selfReviewSuggestions ?? '');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Accumulate all pending field changes — prevents race condition when quickly
  // switching between fields (old approach cleared timer = lost previous field)
  const pendingChanges = useRef<Record<string, string>>({});
  const lastFailedChanges = useRef<Record<string, string>>({});

  const doSave = useCallback(async (changes: Record<string, string>) => {
    try {
      const { data } = await entriesApi.update(entry.id, changes);
      lastFailedChanges.current = {};
      onUpdate(data);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      lastFailedChanges.current = changes;
      setSaveStatus('error');
    }
  }, [entry.id, onUpdate]);

  const scheduleSave = useCallback((field: string, value: string) => {
    pendingChanges.current[field] = value;  // accumulate, don't replace
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    saveTimer.current = setTimeout(async () => {
      const changes = { ...pendingChanges.current };
      pendingChanges.current = {};
      await doSave(changes);
    }, 1000);
  }, [doSave]);

  const handleRetrySave = useCallback(() => {
    const changes = { ...lastFailedChanges.current };
    if (Object.keys(changes).length === 0) return;
    setSaveStatus('saving');
    doSave(changes);
  }, [doSave]);

  const minCorrect = settings?.minSelfReviewCorrectChars ?? 100;
  const minImprove = settings?.minSelfReviewImproveChars ?? 150;
  const minSuggestions = settings?.minSelfReviewSuggestionsChars ?? 0;

  const canSubmit =
    correct.trim().length >= minCorrect &&
    improve.trim().length >= minImprove &&
    (minSuggestions === 0 || suggestions.trim().length >= minSuggestions);

  // Только менеджер может редактировать и сдавать свой черновик
  const isEditable = entry.status === 'draft' && isManager;

  const handleSubmitClick = () => {
    if (!canSubmit || submitting) return;
    setPendingConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    setPendingConfirm(false);
    setSubmitting(true);
    try {
      const { data } = await entriesApi.submit(entry.id);
      onUpdate(data);
      toast.success('Отправлено на ревью');
    } catch (err: unknown) {
      const apiErr = err as { response?: { data?: { message?: string | string[]; errors?: string[] } } };
      const apiData = apiErr?.response?.data;
      if (apiData?.errors?.length) {
        apiData.errors.forEach(e => toast.error(e, { duration: Infinity}));
      } else {
        const msg = apiData?.message;
        toast.error(
          typeof msg === 'string' ? msg :
          Array.isArray(msg) ? msg[0] :
          'Не удалось отправить на ревью'
        , { duration: Infinity });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Save indicator */}
      <div className="flex justify-end h-4" aria-live="polite" aria-atomic="true">
        {saveStatus === 'saving' && <span className="text-micro text-fg-subtle animate-pulse">Сохранение…</span>}
        {saveStatus === 'saved' && <span className="flex items-center gap-1 text-micro text-success-fg"><Check className="w-3.5 h-3.5" aria-hidden="true" /> Сохранено</span>}
        {saveStatus === 'error' && (
          <span className="flex items-center gap-1.5 text-micro text-danger">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Не сохранено
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={handleRetrySave}
            >
              Повторить
            </Button>
          </span>
        )}
      </div>

      {/* Correct */}
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-body font-medium text-fg-muted">
          <ThumbsUp className="w-4 h-4 text-fg-disabled" aria-hidden="true" /> Что сделано правильно
          <ExampleHint text={EXAMPLES.correct} />
        </label>
        <Textarea
          resize="none"
          value={correct}
          onChange={e => {
            setCorrect(e.target.value);
            scheduleSave('selfReviewCorrect', e.target.value);
          }}
          disabled={!isEditable}
          placeholder="Назовите 2–3 конкретных момента разговора, которые прошли хорошо. Что именно вы сделали правильно?"
          rows={4}
        />
        <CharCounter value={correct} min={minCorrect} />
      </div>

      {/* Improve */}
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-body font-medium text-fg-muted">
          <Wrench className="w-4 h-4 text-fg-disabled" aria-hidden="true" /> Что можно улучшить
          <ExampleHint text={EXAMPLES.improve} />
        </label>
        <Textarea
          resize="none"
          value={improve}
          onChange={e => {
            setImprove(e.target.value);
            scheduleSave('selfReviewImprove', e.target.value);
          }}
          disabled={!isEditable}
          placeholder="Какой конкретный момент разговора стоило провести иначе? Что именно и почему?"
          rows={4}
        />
        <CharCounter value={improve} min={minImprove} />
      </div>

      {/* Suggestions */}
      <div className="space-y-1">
        <label className="flex items-center gap-1.5 text-body font-medium text-fg-muted">
          <Lightbulb className="w-4 h-4 text-fg-disabled" aria-hidden="true" /> Конкретные предложения
          <ExampleHint text={EXAMPLES.suggestions} />
        </label>
        <Textarea
          resize="none"
          value={suggestions}
          onChange={e => {
            setSuggestions(e.target.value);
            scheduleSave('selfReviewSuggestions', e.target.value);
          }}
          disabled={!isEditable}
          placeholder="1–2 конкретных шага, которые попробую в следующем звонке."
          rows={3}
        />
        <CharCounter value={suggestions} min={minSuggestions} />
      </div>

      {/* Submit button — только для менеджера на черновике */}
      {isEditable && (
        pendingConfirm ? (
          <div className="rounded-block border border-accent-muted bg-accent-subtle p-3 space-y-2">
            <p className="text-body font-medium text-accent-fg-deep text-center">Отправить на ревью?</p>
            <p className="text-micro text-fg-subtle text-center">РОП получит уведомление и разберёт запись</p>
            <div className="flex gap-2">
              <div className="flex-1">
                <Button variant="secondary" size="md" fullWidth
                  type="button"
                  onClick={() => setPendingConfirm(false)}
                >
                  Отмена
                </Button>
              </div>
              <div className="flex-1">
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  fullWidth
                  onClick={handleConfirmSubmit}
                >
                  Да, отправить
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="md"
            fullWidth
            onClick={handleSubmitClick}
            disabled={!canSubmit || submitting}
          >
            {submitting ? 'Отправляем…' : 'Отправить на ревью'}
          </Button>
        )
      )}

      {entry.status === 'submitted' && (
        <div className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-body text-accent-hover font-medium bg-accent-subtle rounded-block border border-accent-muted">
          <Check className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> Отправлено. Ждём ревью от РОПа.
        </div>
      )}
    </div>
  );
}
