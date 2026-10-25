import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { SourceSelector } from './SourceSelector';
import { ImageDropzone } from './ImageDropzone';
import { AudioDropzone } from './AudioDropzone';
import { CrmCallPicker } from './CrmCallPicker';
import { crmApi } from '@/api/crm';
import { transcriptionApi } from '@/api/transcription';
import { CRM_ERROR_TEXTS, crmErrorCode } from '@/content/crmErrors';
import { Music, Phone, X as XIcon } from 'lucide-react';
import type { EntryType, Entry, CompanySettings, CrmMyStatus, StagedRecording, TranscriptionUsage } from '@/types';
import { entriesApi } from '@/api/entries';
import { Button, Input, ListRow, Textarea, Badge, Notice, Card } from '@chirkov/shell';
import { PreviousReviewsBlock } from './PreviousReviewsBlock';

/**
 * Человеческая причина отказа от сервера (400/403/409): «Запись можно добавить только
 * в активный спринт», «Такая запись уже добавлена» и т.п. Массив message от class-validator
 * это техническая ошибка полей, её пользователю не показываем, останется общий текст.
 */
function serverReason(err: unknown): string | null {
  const res = (err as { response?: { status?: number; data?: { message?: unknown } } }).response;
  if (!res?.status || res.status < 400 || res.status >= 500) return null;
  const message = res.data?.message;
  return typeof message === 'string' && message.trim().length > 0 ? message : null;
}

interface AddEntryFormProps {
  sprintId: string;
  managerId: string;
  companyId: string;
  defaultType?: EntryType;
  existingEntries: Entry[];
  onSuccess: (entry: Entry) => void;
  onCancel: () => void;
  companySettings?: CompanySettings | null;
}

export function AddEntryForm({
  sprintId, managerId, companyId, defaultType = 'call',
  existingEntries, onSuccess, onCancel, companySettings,
}: AddEntryFormProps) {
  const [type, setType] = useState<EntryType>(defaultType);
  // «Вручную» предвыбран для звонков: незнакомые сервисы расшифровки не должны стопорить первую запись
  const [source, setSource] = useState(defaultType === 'call' ? 'Вручную' : '');
  const [sourceCustom, setSourceCustom] = useState('');
  const [date, setDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [transcription, setTranscription] = useState('');
  // Режим ввода для звонка: текст руками или аудиофайл с автотранскрипцией
  const transcriptionEnabled = companySettings?.transcription?.enabled === true;
  // При включённой транскрипции менеджера сразу ведём на «Аудиофайл» (один тап с телефона),
  // а не на ручную вставку простыни текста — это путь наименьшего трения (аудит №13).
  const [callMode, setCallMode] = useState<'text' | 'audio' | 'crm'>(transcriptionEnabled ? 'audio' : 'text');
  // Режим ввода для переписки: скриншоты или текст диалога. Текстом попросил клиент клиента
  // (05.08.2026): «весь диалог скриншотить не всегда удобно, хотелось бы вставлять текстом».
  // Скриншоты остаются первыми: с телефона это по-прежнему путь наименьшего трения.
  const [chatMode, setChatMode] = useState<'screens' | 'text'>('screens');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  // CRM: статус подключения + выбранный из CRM звонок
  const [crmStatus, setCrmStatus] = useState<CrmMyStatus | null>(null);
  const [crmPickerOpen, setCrmPickerOpen] = useState(false);
  const [crmStaged, setCrmStaged] = useState<StagedRecording | null>(null);
  const [screenshots, setScreenshots] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitAttempted, setSubmitAttempted] = useState(false);
  // Остаток минут транскрипции — предупреждаем до загрузки файла с телефона
  const [usage, setUsage] = useState<TranscriptionUsage | null>(null);
  // Восстановление черновика: на мобильном Safari beforeunload не срабатывает,
  // поэтому пишем содержимое в localStorage и предлагаем продолжить при возврате
  const [draftRestored, setDraftRestored] = useState(false);
  const draftGuardRef = useRef<{ key: string; baseline: string; pending: boolean } | null>(null);
  const previousDraftKeyRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // id для связки label↔input (доступность, автозаполнение)
  const ids = useId();
  const sourceCustomId = `${ids}-source-custom`;
  const dateId = `${ids}-date`;
  const transcriptionId = `${ids}-transcription`;

  const draftKey = `add-entry-draft:${sprintId}:${managerId}`;
  const draftSnapshot = JSON.stringify({ type, source, sourceCustom, date, transcription });

  const availableTypes: EntryType[] = [
    ...(companySettings?.callsEnabled !== false ? ['call' as EntryType] : []),
    ...(companySettings?.chatsEnabled !== false ? ['chat' as EntryType] : []),
  ];

  // If only one type available — set it automatically
  useEffect(() => {
    if (availableTypes.length === 1) {
      setType(availableTypes[0]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySettings]);

  // Ctrl+Enter to submit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && isValid() && !loading) {
        e.preventDefault();
        const form = document.querySelector<HTMLFormElement>('[data-entry-form]');
        form?.requestSubmit();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, source, transcription, screenshots]);

  // Warn before navigating away with unsaved content.
  // Для звонка несохранёнными считаются не только текст, но и выбранный аудиофайл
  // и выбранный из CRM звонок — иначе предупреждение их не защищает.
  useEffect(() => {
    const hasContent = type === 'call'
      ? transcription.trim().length > 0 || audioFile !== null || crmStaged !== null
      : screenshots.length > 0 || transcription.trim().length > 0;
    if (!hasContent) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [type, transcription, screenshots, audioFile, crmStaged]);

  // Восстановление черновика при возврате: только текстовые поля
  // (файлы аудио/скриншотов в localStorage не сохранить — это ограничение браузера)
  useEffect(() => {
    const pairChanged = previousDraftKeyRef.current !== null && previousDraftKeyRef.current !== draftKey;
    previousDraftKeyRef.current = draftKey;
    const guard = { key: draftKey, baseline: draftSnapshot, pending: false };
    draftGuardRef.current = guard;
    setDraftRestored(false);

    if (pairChanged) {
      setType(defaultType);
      setSource(defaultType === 'call' ? 'Вручную' : '');
      setSourceCustom('');
      setTranscription('');
    }

    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { type?: EntryType; source?: string; sourceCustom?: string; date?: string; transcription?: string };
      if (!d.transcription?.trim()) {
        localStorage.removeItem(draftKey);
        return;
      }
      guard.pending = true;
      setDraftRestored(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch {
      localStorage.removeItem(draftKey);
    }
  // монтируется один раз на пару sprintId+managerId
  }, [draftKey]);

  const restoreDraft = () => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) {
        const guard = draftGuardRef.current;
        if (guard?.key === draftKey) {
          guard.pending = false;
          guard.baseline = draftSnapshot;
        }
        setDraftRestored(false);
        return;
      }
      const d = JSON.parse(raw) as { type?: EntryType; source?: string; sourceCustom?: string; date?: string; transcription?: string };
      if (d.type) setType(d.type);
      if (d.source !== undefined) setSource(d.source);
      if (d.sourceCustom !== undefined) setSourceCustom(d.sourceCustom);
      if (d.date) setDate(d.date);
      if (d.transcription) setTranscription(d.transcription);
    } catch {
      localStorage.removeItem(draftKey);
    }
    const guard = draftGuardRef.current;
    if (guard?.key === draftKey) {
      guard.pending = false;
      guard.baseline = draftSnapshot;
    }
    setDraftRestored(false);
  };

  const discardDraft = () => {
    localStorage.removeItem(draftKey);
    const guard = draftGuardRef.current;
    if (guard?.key === draftKey) {
      guard.pending = false;
      guard.baseline = draftSnapshot;
    }
    setDraftRestored(false);
  };

  // Автосейв черновика (текстовый режим звонка): переживает сворачивание приложения
  useEffect(() => {
    const guard = draftGuardRef.current;
    if (!guard || guard.key !== draftKey) return;
    if (guard.pending || draftRestored) return; // пока не решили судьбу старого черновика — не перезаписываем
    if (guard.baseline === draftSnapshot) return;
    if (transcription.trim().length === 0) {
      localStorage.removeItem(draftKey);
      guard.baseline = draftSnapshot;
      return;
    }
    localStorage.setItem(draftKey, JSON.stringify({ type, source, sourceCustom, date, transcription }));
    guard.baseline = draftSnapshot;
  }, [draftKey, draftRestored, draftSnapshot, type, source, sourceCustom, date, transcription]);

  // Global Ctrl+V listener: capture image from clipboard when type === 'chat'
  useEffect(() => {
    // В текстовом режиме переписки перехват картинок не нужен: менеджер вставляет диалог
    // словами, и подхваченный скриншот всё равно не уехал бы вместе с записью.
    if (type !== 'chat' || chatMode !== 'screens') return;
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        setScreenshots(prev => [...prev, ...imageFiles].slice(0, 10));
        e.preventDefault();
      }
    };
    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [type, chatMode]);

  useEffect(() => {
    if (!transcriptionEnabled) return;
    crmApi.myStatus().then(({ data }) => setCrmStatus(data)).catch(() => undefined);
    transcriptionApi.getMyUsage().then(({ data }) => setUsage(data)).catch(() => undefined);
  }, [transcriptionEnabled]);

  const callCount = existingEntries.filter(e => e.type === 'call').length;
  const chatCount = existingEntries.filter(e => e.type === 'chat').length;
  const entryNumber = type === 'call' ? callCount + 1 : chatCount + 1;

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setTranscription(prev => prev + text);
    } catch {
      setError('Не удалось прочитать буфер обмена. Вставьте текст в поле вручную.');
    }
  }, []);

  // Лимит минут транскрипции исчерпан: блокируем режимы, которые тратят минуты (аудио, CRM)
  const minutesExhausted = usage?.limitMinutes != null && usage.usedMinutes >= usage.limitMinutes;

  const isValid = () => {
    const crmMode = type === 'call' && transcriptionEnabled && callMode === 'crm';
    if (!source && !crmMode) return false;
    if (type === 'call') {
      if (transcriptionEnabled && callMode === 'audio') return audioFile !== null && !minutesExhausted;
      if (transcriptionEnabled && callMode === 'crm') return crmStaged !== null && !minutesExhausted;
      return transcription.trim().length >= 10;
    }
    // Переписка: либо скриншоты, либо вставленный текст диалога — что удобнее менеджеру
    if (chatMode === 'text') return transcription.trim().length >= 10;
    return screenshots.length > 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!isValid()) return;
    setLoading(true);
    setError('');

    // Разводим сценарии ошибок: упал create — данные в форме, можно повторить;
    // упала загрузка скриншотов — запись уже создана, повторная отправка создаст дубль.
    let createdEntry: Entry | null = null;
    try {
      const isCrm = type === 'call' && transcriptionEnabled && callMode === 'crm' && crmStaged;
      const { data: entry } = await entriesApi.create({
        sprintId, managerId, companyId, type, entryNumber,
        entryDate: isCrm ? crmStaged.callDate : date,
        source: isCrm ? (crmStaged.provider === 'amocrm' ? 'amoCRM' : 'Битрикс24') : (source === 'other' ? sourceCustom : source),
        sourceCustom: source === 'other' && !isCrm ? sourceCustom : undefined,
        transcription:
          type === 'chat'
            ? (chatMode === 'text' ? transcription : undefined)
            : !(transcriptionEnabled && callMode !== 'text') ? transcription : undefined,
        ...(isCrm ? {
          stagedRecordingId: crmStaged.stagedRecordingId,
          crmCallId: crmStaged.callId,
          crmProvider: crmStaged.provider,
          crmCallMetadata: { phone: crmStaged.phone, direction: crmStaged.direction, durationSec: crmStaged.durationSec, callStartedAt: crmStaged.callDate },
        } : {}),
      });
      createdEntry = entry;
      localStorage.removeItem(draftKey); // запись создана — черновик больше не нужен
    } catch (err) {
      // Протухший staged-файл из CRM: запись не создана, выбранный звонок устарел.
      // Сбрасываем выбор и заново открываем пикер, чтобы менеджер взял свежую запись.
      if (crmErrorCode(err) === 'STAGED_EXPIRED') {
        setCrmStaged(null);
        setCrmPickerOpen(true);
        setError(CRM_ERROR_TEXTS.STAGED_EXPIRED);
        setLoading(false);
        return;
      }
      // Сервер объясняет отказ словами (закрытая неделя, дубль номера, чужая компания).
      // Раньше любой такой отказ показывался как «проверьте соединение», и человек
      // жал «Добавить» по кругу, хотя связь была в порядке.
      setError(serverReason(err) ?? 'Не удалось создать запись. Всё, что вы ввели, осталось в форме. Проверьте соединение и нажмите «Добавить» ещё раз.');
      setLoading(false);
      return;
    }

    try {
      let uploadedScreenshots = createdEntry.screenshots ?? [];
      if (type === 'chat' && screenshots.length > 0) {
        const { data } = await entriesApi.uploadScreenshots(createdEntry.id, screenshots);
        uploadedScreenshots = data;
      }
      if (type === 'call' && transcriptionEnabled && callMode === 'audio' && audioFile) {
        await entriesApi.uploadAudio(createdEntry.id, audioFile, setUploadPct);
        toast.success('Запись добавлена. Транскрибируем звонок, текст появится через пару минут.');
      } else if (type === 'call' && transcriptionEnabled && callMode === 'crm' && crmStaged) {
        toast.success('Звонок из CRM добавлен. Транскрибируем запись, текст появится через пару минут.');
      } else {
        toast.success('Запись добавлена');
      }
      onSuccess({ ...createdEntry, screenshots: uploadedScreenshots });
    } catch {
      if (type === 'call' && callMode === 'audio') {
        toast.error('Запись создана, но аудио не загрузилось. Откройте запись и вставьте текст вручную, либо удалите её и повторите.', { duration: Infinity });
      } else {
        toast.error('Запись создана, но скриншоты не загрузились. Откройте запись и добавьте их ещё раз, новую запись создавать не нужно.', { duration: Infinity });
      }
      onSuccess(createdEntry);
    } finally {
      setLoading(false);
    }
  };

  // Подсказки валидации показываем у проблемного поля после попытки отправки
  const sourceInvalid = submitAttempted && !source;
  const transcriptionInvalid = submitAttempted && type === 'call' && transcription.trim().length < 10;
  const screenshotsInvalid = submitAttempted && type === 'chat' && chatMode === 'screens' && screenshots.length === 0;
  const chatTextInvalid = submitAttempted && type === 'chat' && chatMode === 'text' && transcription.trim().length < 10;

  return (
    <Card padding="md" tone="accent" elevation="raised">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-body-lg font-semibold text-fg">Новая запись</h3>
        <Button onClick={onCancel} type="button" variant="ghost" size="sm" aria-label="Закрыть форму">✕</Button>
      </div>

      {/* Восстановление черновика после сворачивания приложения (мобильный Safari) */}
      {draftRestored && (
        <div className="mb-5">
          <Notice tone="warning" title="Найден несохранённый черновик прошлой записи. Восстановить текст?">
            <div className="flex items-center gap-2">
              <Button type="button" variant="link" size="sm" onClick={restoreDraft}>
                Восстановить
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={discardDraft}>
                Сбросить
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {/* Возврат к обратной связи перед самоанализом: прошлые разборы этого
          менеджера, без блокировки записи (принятый визуал задачи 1) */}
      <PreviousReviewsBlock />

      {/* Tab switcher — only show available types */}
      {availableTypes.length > 1 && (
        <div role="tablist" aria-label="Тип записи" className="flex rounded-card bg-surface-sunken p-1 gap-1 mb-5 w-fit max-w-full flex-wrap">
          {availableTypes.map(t => (
            <Button
              key={t}
              type="button"
              variant={type === t ? 'secondary' : 'ghost'}
              size="sm"
              role="tab"
              aria-selected={type === t}
              onClick={() => { setType(t); setSource(''); }}
            >
              {t === 'call' ? '📞 Звонок' : '💬 Переписка'}
            </Button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" data-entry-form>
        {/* Source — в режиме «Из CRM» источник проставляется автоматически */}
        {!(type === 'call' && transcriptionEnabled && callMode === 'crm') && (
        <div>
          <label className="block text-body font-medium text-fg-muted mb-2">
            {type === 'call' ? 'Источник' : 'Канал'}
          </label>
          <div className={sourceInvalid ? 'rounded-block ring-2 ring-danger-border p-2 -m-2' : undefined}>
            <SourceSelector
              type={type}
              value={source}
              onChange={setSource}
              sources={type === 'call' ? companySettings?.callSources : companySettings?.chatSources}
            />
          </div>
          {sourceInvalid && <p className="text-micro text-danger mt-1" role="alert">Выберите источник</p>}
          {(source === 'other' || source === 'Другое') && (
            <div className="mt-2">
              <Input
                id={sourceCustomId}
                type="text"
                value={sourceCustom}
                onChange={e => setSourceCustom(e.target.value)}
                placeholder="Укажите канал..."
                aria-label={type === 'call' ? 'Свой источник' : 'Свой канал'}
              />
            </div>
          )}
        </div>
        )}

        {/* Date and number */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-36" data-ds-exception="браузерная дата до DateField 0.9.1">
            <label htmlFor={dateId} className="block text-body font-medium text-fg-muted mb-1">Дата</label>
            <Input
              id={dateId}
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })()}
            />
          </div>
          <div>
            <label className="block text-body font-medium text-fg-muted mb-1">Номер</label>
            <div className="px-3 py-2 bg-canvas border border-border rounded-card text-body text-fg-muted" data-ui-role="readonly-value">
              #{entryNumber}
            </div>
          </div>
        </div>

        {/* Transcription for calls */}
        {type === 'call' && transcriptionEnabled && (
          <div role="tablist" aria-label="Способ добавления разговора" className="flex rounded-card bg-surface-sunken p-1 gap-1 w-fit max-w-full flex-wrap">
            {([
              // Основной путь — аудиофайл и «Из CRM»: запись в один тап с авто-транскрипцией.
              // Аудио и CRM тратят минуты транскрипции — при исчерпанном лимите блокируем
              { mode: 'audio', label: 'Аудиофайл', disabled: minutesExhausted, reason: minutesExhausted ? 'Лимит минут транскрипции исчерпан' : undefined },
              // Вкладку «Из CRM» показываем всегда при подключённой CRM. Если менеджер
              // не сопоставлен — она задизейблена с объяснением причины (USER_NOT_MAPPED)
              ...(crmStatus?.connected ? [{
                mode: 'crm',
                label: 'Из CRM',
                disabled: !crmStatus.mapped || minutesExhausted,
                reason: !crmStatus.mapped
                  ? CRM_ERROR_TEXTS.USER_NOT_MAPPED
                  : minutesExhausted ? 'Лимит минут транскрипции исчерпан' : undefined,
              }] : []),
              // Ручная вставка текста — запасной путь (с телефона вставлять простыню тяжело)
              { mode: 'text', label: 'Текст', disabled: false, reason: undefined },
            ] as { mode: 'text' | 'audio' | 'crm'; label: string; disabled: boolean; reason?: string }[]).map(({ mode, label, disabled, reason }) => (
              <Button
                key={mode}
                type="button"
                variant={callMode === mode ? 'secondary' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={callMode === mode}
                disabled={disabled}
                title={reason}
                onClick={() => setCallMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        {/* Причина недоступности «Из CRM» текстом — title не виден на тач-устройствах */}
        {type === 'call' && transcriptionEnabled && crmStatus?.connected && !crmStatus.mapped && (
          <p className="text-micro text-fg-subtle -mt-2">{CRM_ERROR_TEXTS.USER_NOT_MAPPED}</p>
        )}
        {type === 'call' && transcriptionEnabled && callMode === 'audio' && (
          <div>
            <label className="block text-body font-medium text-fg-muted mb-2">Запись звонка</label>
            {minutesExhausted && (
              <p className="text-micro text-danger-fg bg-danger-subtle border border-danger-border rounded-card px-3 py-2 mb-2" role="alert">
                Лимит минут транскрипции на этот месяц исчерпан. Загрузить аудио не получится: добавьте текст разговора вручную или попросите владельца увеличить лимит.
              </p>
            )}
            <AudioDropzone file={audioFile} onChange={setAudioFile} />
            {submitAttempted && !audioFile && <p className="text-micro text-danger mt-1" role="alert">Добавьте аудиофайл записи звонка</p>}
            {loading && uploadPct > 0 && uploadPct < 100 && (
              <div className="mt-2 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${uploadPct}%` }} />
              </div>
            )}
            <p className="text-micro text-fg-subtle mt-2">Платформа сама превратит запись в текст диалога. Распознаются разговоры на русском языке.</p>
          </div>
        )}
        {type === 'call' && transcriptionEnabled && callMode === 'crm' && (
          <div>
            <label className="block text-body font-medium text-fg-muted mb-2">Звонок из CRM</label>
            {crmStaged ? (
              <div className="flex items-center gap-3 p-3 bg-canvas border border-border rounded-block" data-ui-role="selection-preview">
                <div className="w-9 h-9 rounded-card bg-accent-subtle-hover flex items-center justify-center flex-shrink-0">
                  <Music className="w-4 h-4 text-accent-hover" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-body font-medium text-fg truncate">{crmStaged.fileName}</p>
                  <p className="text-micro text-fg-subtle">{crmStaged.phone} · {Math.floor(crmStaged.durationSec / 60)}:{String(crmStaged.durationSec % 60).padStart(2, '0')}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCrmStaged(null)} aria-label="Убрать звонок" icon={<XIcon />} />
              </div>
            ) : (
              <ListRow type="button" tone="accent-soft" icon={<Phone />} onClick={() => setCrmPickerOpen(true)}>
                <span className="flex flex-col items-start w-full">
                  <span className="text-body text-fg font-medium">Выбрать звонок из {crmStatus?.provider === 'amocrm' ? 'amoCRM' : 'Битрикс24'}</span>
                  <span className="text-micro text-fg-subtle mt-1">Покажем только ваши звонки. Платформа скачает запись и превратит её в текст.</span>
                </span>
              </ListRow>
            )}
            {submitAttempted && !crmStaged && <p className="text-micro text-danger mt-1" role="alert">Выберите звонок из CRM</p>}
          </div>
        )}
        {crmPickerOpen && (
          <CrmCallPicker
            onPicked={staged => { setCrmStaged(staged); setCrmPickerOpen(false); }}
            onClose={() => setCrmPickerOpen(false)}
          />
        )}
        {type === 'call' && !(transcriptionEnabled && callMode !== 'text') && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={transcriptionId} className="block text-body font-medium text-fg-muted">Текст разговора (транскрипция)</label>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handlePaste}
              >
                📋 Вставить из буфера
              </Button>
            </div>
            <Textarea font="mono" resize="none"
              id={transcriptionId}
              ref={textareaRef}
              value={transcription}
              onChange={e => setTranscription(e.target.value)}
              placeholder="Вставьте транскрипцию разговора. Формат свободный."
              rows={10}
            />
            {transcriptionInvalid && <p className="text-micro text-danger mt-1" role="alert">Добавьте транскрипцию (минимум 10 символов)</p>}
          </div>
        )}

        {/* Переписка: скриншоты или текст диалога */}
        {type === 'chat' && (
          <div role="tablist" aria-label="Способ добавления переписки" className="flex rounded-card bg-surface-sunken p-1 gap-1 w-fit max-w-full flex-wrap">
            {([
              { mode: 'screens', label: 'Скриншоты' },
              { mode: 'text', label: 'Текст' },
            ] as { mode: 'screens' | 'text'; label: string }[]).map(({ mode, label }) => (
              <Button
                key={mode}
                type="button"
                variant={chatMode === mode ? 'secondary' : 'ghost'}
                size="sm"
                role="tab"
                aria-selected={chatMode === mode}
                onClick={() => setChatMode(mode)}
              >
                {label}
              </Button>
            ))}
          </div>
        )}

        {type === 'chat' && chatMode === 'screens' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-body font-medium text-fg-muted">Скриншоты</label>
              {screenshots.length > 0 && (
                <Badge tone="success">
                  ✓ {screenshots.length} {screenshots.length === 1 ? 'скриншот' : screenshots.length < 5 ? 'скриншота' : 'скриншотов'} добавлено
                </Badge>
              )}
            </div>
            <ImageDropzone files={screenshots} onChange={setScreenshots} />
            {screenshotsInvalid && <p className="text-micro text-danger mt-1" role="alert">Добавьте хотя бы один скриншот</p>}
          </div>
        )}

        {type === 'chat' && chatMode === 'text' && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor={transcriptionId} className="block text-body font-medium text-fg-muted">Текст переписки</label>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={handlePaste}
              >
                📋 Вставить из буфера
              </Button>
            </div>
            <Textarea font="mono" resize="none"
              id={transcriptionId}
              value={transcription}
              onChange={e => setTranscription(e.target.value)}
              placeholder="Скопируйте диалог из мессенджера и вставьте сюда. Формат свободный, имена можно оставить как есть."
              rows={10}
            />
            {chatTextInvalid && <p className="text-micro text-danger mt-1" role="alert">Вставьте текст переписки (минимум 10 символов)</p>}
          </div>
        )}


        {error && (
          <p className="text-body text-danger bg-danger-subtle px-3 py-2 rounded-card" role="alert">{error}</p>
        )}

        {/* Submit */}
        <div className="flex flex-wrap gap-3 pt-2">
          <div className="flex-1 min-w-48">
            <Button
              type="submit"
              variant="primary"
              size="md"
              fullWidth
              disabled={!isValid() || loading}
              title={isValid() ? 'Ctrl+Enter' : undefined}
            >
              {loading ? 'Добавление...' : `Добавить ${type === 'call' ? 'звонок' : 'переписку'}`}
              {isValid() && !loading && (
                <span className="ml-2 opacity-70 text-micro font-normal hidden md:inline">Ctrl+↵</span>
              )}
            </Button>
          </div>
          <Button variant="ghost" size="md"
            type="button"
            onClick={onCancel}
          >
            Отмена
          </Button>
        </div>
      </form>
    </Card>
  );
}
