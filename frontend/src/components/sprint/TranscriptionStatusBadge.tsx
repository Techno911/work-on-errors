import { useEffect, useState, useRef } from 'react';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { entriesApi } from '@/api/entries';
import { useAuthStore } from '@/stores/authStore';
import { AudioDropzone } from './AudioDropzone';
import { Button, Modal, Textarea } from '@chirkov/shell';
import type { Entry, EntryAudio } from '@/types';

const IN_PROGRESS = ['converting', 'queued', 'transcribing'];

// Честная оценка времени распознавания от длительности записи.
// Распознавание идёт быстрее реального времени, но для длинных звонков
// «1–3 минуты» — неправда. Считаем грубую вилку и округляем до минут.
function estimateText(durationSec: number): string {
  if (!durationSec || durationSec <= 0) return 'обычно занимает 1–2 минуты';
  const lowMin = Math.max(1, Math.round((durationSec * 0.15) / 60));
  const highMin = Math.max(lowMin + 1, Math.round((durationSec * 0.4) / 60));
  if (highMin <= 2) return 'обычно занимает 1–2 минуты';
  return `обычно занимает ${lowMin}–${highMin} ${highMin < 5 ? 'минуты' : 'минут'}`;
}

// Отдельный текст на каждый промежуточный статус — раньше все три были неразличимы.
function progressText(status: string, durationSec: number): string {
  const est = estimateText(durationSec);
  if (status === 'converting') return `Готовим запись к распознаванию: ${est}.`;
  if (status === 'queued') return `Запись в очереди на распознавание: ${est}.`;
  return `Распознаём речь: ${est}.`;
}

/**
 * Блок аудио в карточке записи: плеер + статус транскрипции.
 * Поллит /entries/:id/audio каждые 5 секунд, пока идёт распознавание.
 * Когда транскрипция готова и в записи уже есть ручной текст — предлагает заменить по кнопке.
 */
export function TranscriptionStatusBadge({ entry, onUpdate }: { entry: Entry; onUpdate: (e: Entry) => void }) {
  const [audio, setAudio] = useState<EntryAudio | null>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [applying, setApplying] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState('');
  const [savingManual, setSavingManual] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const entryRef = useRef(entry);
  entryRef.current = entry;

  const user = useAuthStore(s => s.user);
  // Восстановить упавшую транскрипцию может только автор записи, пока она в черновике.
  const canRecover = user?.role === 'manager' && entry.status === 'draft';

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      try {
        const { data } = await entriesApi.getAudio(entry.id);
        if (cancelled) return;
        setAudio(data ?? null);
        setLoaded(true);
        if (data && IN_PROGRESS.includes(data.status)) {
          timer = setTimeout(tick, 5000);
        } else if (data?.status === 'done' && data.appliedAt && !(entryRef.current.transcription ?? '').trim()) {
          // Транскрипция дописалась в фоне — подтягиваем свежую запись
          const { data: fresh } = await entriesApi.getById(entry.id);
          if (!cancelled) onUpdate(fresh);
        }
      } catch {
        setLoaded(true);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id]);

  // Запись звонка — ПД клиента: грузим её авторизованным запросом (Bearer-токен),
  // а не прямой ссылкой /uploads, и показываем через objectURL.
  const audioReady = !!audio && audio.status !== 'failed';
  useEffect(() => {
    if (!audioReady) { setAudioSrc(null); return; }
    let cancelled = false;
    let url: string | null = null;
    entriesApi.getAudioBlob(entry.id)
      .then(({ data }) => {
        if (cancelled) return;
        url = URL.createObjectURL(data);
        setAudioSrc(url);
      })
      .catch(() => { if (!cancelled) setAudioSrc(null); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.id, audioReady]);

  if (!loaded || !audio) return null;

  const apply = async () => {
    setApplying(true);
    try {
      const { data } = await entriesApi.applyAudioTranscription(entry.id);
      onUpdate(data);
      setReplaceOpen(false);
      toast.success('Текст заменён транскрипцией');
    } catch {
      toast.error('Не удалось применить транскрипцию', { duration: Infinity });
    } finally {
      setApplying(false);
    }
  };

  // Повторная загрузка файла после неудачной транскрипции — снова запускает пайплайн.
  const retryUpload = async (file: File) => {
    setRetrying(true);
    try {
      const { data } = await entriesApi.uploadAudio(entry.id, file);
      setAudio(data);
      toast.success('Файл загружен, распознаём заново');
    } catch {
      toast.error('Не удалось загрузить файл. Попробуйте ещё раз.', { duration: Infinity });
    } finally {
      setRetrying(false);
    }
  };

  // Ручной ввод текста разговора, когда распознавание не справилось.
  const saveManual = async () => {
    const text = manualText.trim();
    if (!text) return;
    setSavingManual(true);
    try {
      const { data } = await entriesApi.update(entry.id, { transcription: text });
      onUpdate(data);
      setManualOpen(false);
      setManualText('');
      toast.success('Текст разговора сохранён');
    } catch {
      toast.error('Не удалось сохранить текст', { duration: Infinity });
    } finally {
      setSavingManual(false);
    }
  };

  const resultDiffers =
    audio.status === 'done' &&
    !!audio.transcriptionResult &&
    (entry.transcription ?? '').trim() !== audio.transcriptionResult.trim();

  return (
    <div className="space-y-2" data-ui-role="transcription-status-panel">
      {audioSrc && <audio controls src={audioSrc} className="w-full h-9" />}
      {IN_PROGRESS.includes(audio.status) && (
        <p className="flex items-center gap-1.5 text-micro text-fg-subtle">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          {progressText(audio.status, audio.durationSec)} Можно уйти со страницы, текст появится сам.
        </p>
      )}
      {audio.status === 'failed' && (
        <div className="space-y-2">
          <p className="flex items-start gap-1.5 text-micro text-danger-fg">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            {audio.errorMessage ?? 'Не получилось распознать запись. Вставьте текст вручную.'}
          </p>
          {canRecover && (
            <div className="space-y-2">
              {retrying ? (
                <p className="flex items-center gap-1.5 text-micro text-fg-subtle">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                  Загружаем файл…
                </p>
              ) : (
                <AudioDropzone file={null} onChange={f => { if (f) retryUpload(f); }} />
              )}
              {manualOpen ? (
                <div className="space-y-2">
                  <Textarea
                    value={manualText}
                    onChange={e => setManualText(e.target.value)}
                    rows={5}
                    placeholder="Вставьте текст разговора. Например: «Голос 1: Здравствуйте… Голос 2: Добрый день…»"
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={savingManual || !manualText.trim()}
                      onClick={saveManual}
                    >
                      {savingManual ? 'Сохраняем…' : 'Сохранить текст'}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => { setManualOpen(false); setManualText(''); }}
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  onClick={() => setManualOpen(true)}
                >
                  Вставить текст вручную
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {audio.status === 'done' && !resultDiffers && (
        <p className="flex items-center gap-1.5 text-micro text-success-fg">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Текст ниже получен автоматически из записи
        </p>
      )}
      {resultDiffers && (
        <Button
          type="button"
          variant="link"
          size="sm"
          disabled={applying}
          onClick={() => setReplaceOpen(true)}
        >
          {applying ? 'Заменяем…' : 'Заменить текст готовой транскрипцией'}
        </Button>
      )}

      {resultDiffers && (
        <Modal
          size="lg"
          open={replaceOpen}
          onClose={() => { if (!applying) setReplaceOpen(false); }}
          title="Заменить текст разговора?"
          description="Текущий текст будет перезаписан распознанной транскрипцией. Сравните перед заменой."
          footer={(
            <>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => setReplaceOpen(false)}
                disabled={applying}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={apply}
                disabled={applying}
              >
                {applying ? 'Заменяем…' : 'Заменить текст'}
              </Button>
            </>
          )}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-border sm:divide-x">
            <div className="p-4 space-y-2">
              <div className="text-micro font-semibold text-fg-subtle tracking-overline">Текущий текст</div>
              <pre className="whitespace-pre-wrap text-body text-fg-muted bg-canvas rounded-card p-3 max-h-[45vh] overflow-y-auto">
                {(entry.transcription ?? '').trim() || 'пусто'}
              </pre>
            </div>
            <div className="p-4 space-y-2">
              <div className="text-micro font-semibold text-accent-hover tracking-overline">Распознанная транскрипция</div>
              <pre className="whitespace-pre-wrap text-body text-fg-muted bg-accent-subtle rounded-card p-3 max-h-[45vh] overflow-y-auto">
                {(audio.transcriptionResult ?? '').trim()}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
