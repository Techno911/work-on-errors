import { useState, useEffect, useMemo } from 'react';
import {
  X, ChevronLeft, ChevronRight, MessageSquare, AlignLeft, KeyRound, Bell, Sparkles,
  TrendingUp, BookOpen, type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { Button, Modal } from '@chirkov/shell';
import { usersApi } from '@/api/users';
import {
  RELEASES, releasesFor, slidesFor, latestKnownVersion,
  type ReleaseIcon, type ReleaseSlide, type ReleaseAudience,
} from '@/content/releases';

const ICONS: Record<ReleaseIcon, LucideIcon> = {
  chat: MessageSquare,
  text: AlignLeft,
  key: KeyRound,
  bell: Bell,
  sparkles: Sparkles,
  chart: TrendingUp,
  book: BookOpen,
};

/** Событие «показать анонс ещё раз» — его шлёт клик по версии в боковом меню. */
export const WHATS_NEW_EVENT = 'whats-new:open';

export function openWhatsNew() {
  window.dispatchEvent(new CustomEvent(WHATS_NEW_EVENT));
}

interface Props {
  /** Повторный просмотр: показываем последний выпуск, отметку прочтения не трогаем. */
  replay?: boolean;
  onClose: () => void;
}

/**
 * «Что нового»: рассказ о заметных изменениях платформы при первом входе после выката.
 *
 * Показывается один раз: при закрытии в профиль пишется последняя известная версия, и до
 * следующего анонса окно не появится. Содержание и решение «рассказывать ли вообще» живут
 * в src/content/releases.ts, здесь только показ.
 */
export function WhatsNewModal({ replay = false, onClose }: Props) {
  const user = useAuthStore(s => s.user);
  const [step, setStep] = useState(0);
  const [closing, setClosing] = useState(false);

  const role = user?.role as ReleaseAudience | undefined;

  // Лента: все непрочитанные выпуски подряд, слайды только своей роли. В повторном просмотре
  // берём последний выпуск целиком, независимо от отметки прочтения.
  const shown = useMemo(() => {
    if (replay) {
      const last = RELEASES[0];
      if (!last || !role || !last.audience.includes(role)) return [];
      const slides = slidesFor(last, role);
      return slides.length > 0 ? [{ ...last, slides }] : [];
    }
    return releasesFor(role, user?.releasesSeenVersion ?? null);
  }, [replay, role, user?.releasesSeenVersion]);

  const flat = useMemo(
    () => shown.flatMap(r => r.slides.map(slide => ({ slide, release: r }))),
    [shown],
  );

  // Лента могла сократиться (сменилась роль в этой же сессии) — не даём шагу уехать за край.
  useEffect(() => {
    setStep(s => Math.min(s, Math.max(0, flat.length - 1)));
  }, [flat.length]);

  const markSeen = async () => {
    if (replay) return;
    try {
      const version = latestKnownVersion();
      await usersApi.markReleasesSeen(version);
      // Локально тоже обновляем: иначе окно вернётся при переходе между страницами,
      // пока пользователь не перелогинится.
      const current = useAuthStore.getState().user;
      if (current) useAuthStore.getState().setUser({ ...current, releasesSeenVersion: version });
    } catch {
      // Отметка не критична для работы: не блокируем закрытие окна из-за сети.
    }
  };

  const handleClose = async () => {
    if (closing) return;
    setClosing(true);
    await markSeen();
    onClose();
  };

  if (flat.length === 0) return null;

  const index = Math.min(step, flat.length - 1);
  const { slide, release } = flat[index];
  const isLast = index === flat.length - 1;
  const Icon = ICONS[slide.icon] ?? Sparkles;

  return (
    <Modal
      open
      onClose={handleClose}
      closeOnBackdrop={false}
      title={release.headline}
      footer={
        <>
          <Button
            type="button"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={index === 0}
            variant="ghost"
            size="sm"
            icon={<ChevronLeft />}
          >
            Назад
          </Button>
          {isLast ? (
            <Button type="button" onClick={handleClose}>
              Понятно
            </Button>
          ) : (
            <Button type="button" onClick={() => setStep(s => s + 1)} iconRight={<ChevronRight />}>
              Далее
</Button>
          )}
        </>
      }
    >
      {/* Запись истории выпусков называет номер выпуска, о котором рассказывает: это содержание,
          а не метка сборки, поэтому номер законно стоит здесь (КАНОН-ОБОЛОЧКИ §14). Строка даты и
          номера живёт в теле окна, а не в description Modal: description пакет рисует в шапке,
          куда исключение не поставить. */}
      <div data-ds-exception="история выпусков">
        <p className="text-micro text-fg-muted mb-3">{release.date} · версия {release.version}</p>

        {/* Прогресс по слайдам */}
        {flat.length > 1 && (
          <div className="flex gap-1 mb-4">
            {flat.map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-1 rounded-full transition-all ${i <= index ? 'bg-accent' : 'bg-border'}`}
              />
            ))}
          </div>
        )}

        {/* Слайд */}
        <div
          className="w-12 h-12 mb-3 rounded-block flex items-center justify-center bg-accent-subtle"
        >
          <Icon className="w-6 h-6 text-accent" />
        </div>
        <h3 className="font-heading text-body-lg font-semibold text-fg mb-2">{slide.title}</h3>
        <p className="text-body text-fg-muted">{slide.body}</p>
      </div>
    </Modal>
  );
}

/**
 * Обёртка, которая решает, показывать ли окно. Живёт в AppLayout, поэтому анонс догоняет
 * человека на любой странице, а не только на главной.
 *
 * Новичку анонс не нужен: он и так видит платформу впервые, ему показывается вводный тур.
 * Поэтому при непройденном туре отметку проставляем молча, без окна.
 */
export function WhatsNewGate() {
  const user = useAuthStore(s => s.user);
  const [replay, setReplay] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const open = () => { setReplay(true); setDismissed(false); };
    window.addEventListener(WHATS_NEW_EVENT, open);
    return () => window.removeEventListener(WHATS_NEW_EVENT, open);
  }, []);

  const isNewcomer = Boolean(user) && !user?.onboardingSeenAt;

  // Новичок: тихо отмечаем анонсы прочитанными, чтобы окно не догнало его сразу после тура.
  useEffect(() => {
    if (!user || !isNewcomer || user.releasesSeenVersion) return;
    const version = latestKnownVersion();
    usersApi.markReleasesSeen(version)
      .then(() => {
        const current = useAuthStore.getState().user;
        if (current) useAuthStore.getState().setUser({ ...current, releasesSeenVersion: version });
      })
      .catch(() => {});
  }, [user, isNewcomer]);

  if (!user || dismissed) return null;
  if (!replay && isNewcomer) return null;

  return (
    <WhatsNewModal
      replay={replay}
      onClose={() => { setDismissed(true); setReplay(false); }}
    />
  );
}
