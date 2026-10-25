import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button, Card } from '@chirkov/shell';
import { entriesApi } from '@/api/entries';
import type { EntryScreenshot } from '@/types';

interface ScreenshotGalleryProps {
  entryId: string;
  screenshots: EntryScreenshot[];
}

export function ScreenshotGallery({ entryId, screenshots }: ScreenshotGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // Скриншоты переписок — ПД клиента: грузим авторизованным запросом (Bearer-токен),
  // а не прямой ссылкой /uploads. Карта screenshotId → objectURL.
  const [urls, setUrls] = useState<Record<string, string>>({});

  // Зум/панорамирование лайтбокса (мобильный: текст переписки читаем при увеличении).
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Жесты: один палец — свайп между скриншотами (при zoom 1) или панорама (при zoom > 1);
  // два пальца — pinch-зум. Состояние держим в ref, чтобы не дёргать ререндер на каждое касание.
  const gesture = useRef<{
    mode: 'none' | 'swipe' | 'pan' | 'pinch';
    startX: number; startY: number;
    startPan: { x: number; y: number };
    startDist: number; startZoom: number;
    swipeDx: number;
  }>({ mode: 'none', startX: 0, startY: 0, startPan: { x: 0, y: 0 }, startDist: 0, startZoom: 1, swipeDx: 0 });
  const lastTap = useRef(0);

  const resetZoom = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  const goTo = useCallback((next: number) => {
    resetZoom();
    setLightboxIndex(next);
  }, [resetZoom]);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    Promise.all(
      screenshots.map(async (s) => {
        try {
          const { data } = await entriesApi.getScreenshotBlob(entryId, s.id);
          const url = URL.createObjectURL(data);
          created.push(url);
          return [s.id, url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (cancelled) {
        created.forEach((u) => URL.revokeObjectURL(u));
        return;
      }
      setUrls(Object.fromEntries(pairs.filter((p): p is readonly [string, string] => p !== null)));
    });
    return () => {
      cancelled = true;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, screenshots.map((s) => s.id).join(',')]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') goTo(lightboxIndex < screenshots.length - 1 ? lightboxIndex + 1 : 0);
      if (e.key === 'ArrowLeft') goTo(lightboxIndex > 0 ? lightboxIndex - 1 : screenshots.length - 1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex, screenshots.length, goTo]);

  const dist = (t: React.TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length === 2) {
      g.mode = 'pinch';
      g.startDist = dist(e.touches);
      g.startZoom = zoom;
    } else if (e.touches.length === 1) {
      g.mode = zoom > 1 ? 'pan' : 'swipe';
      g.startX = e.touches[0].clientX;
      g.startY = e.touches[0].clientY;
      g.startPan = { ...pan };
      g.swipeDx = 0;
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const next = Math.min(4, Math.max(1, g.startZoom * (dist(e.touches) / g.startDist)));
      setZoom(next);
      if (next === 1) setPan({ x: 0, y: 0 });
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      setPan({ x: g.startPan.x + (e.touches[0].clientX - g.startX), y: g.startPan.y + (e.touches[0].clientY - g.startY) });
    } else if (g.mode === 'swipe' && e.touches.length === 1) {
      g.swipeDx = e.touches[0].clientX - g.startX;
    }
  };

  const onTouchEnd = () => {
    const g = gesture.current;
    if (g.mode === 'swipe' && lightboxIndex !== null && screenshots.length > 1 && Math.abs(g.swipeDx) > 60) {
      if (g.swipeDx < 0) goTo(lightboxIndex < screenshots.length - 1 ? lightboxIndex + 1 : 0);
      else goTo(lightboxIndex > 0 ? lightboxIndex - 1 : screenshots.length - 1);
    }
    g.mode = 'none';
  };

  // Double-tap (или двойной клик) — переключение зума 1× ↔ 2×.
  const handleDoubleActivate = () => {
    if (zoom > 1) resetZoom();
    else setZoom(2);
  };

  const onImageTouchEnd = (e: React.TouchEvent) => {
    onTouchEnd();
    const now = Date.now();
    if (now - lastTap.current < 300) {
      e.preventDefault();
      handleDoubleActivate();
    }
    lastTap.current = now;
  };

  if (screenshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 bg-canvas rounded-card border border-dashed border-border-strong" data-ui-role="media-slot">
        <span className="text-body text-fg-subtle">Скриншоты не добавлены</span>
      </div>
    );
  }

  return (
    <>
      <div className={screenshots.length === 1 ? 'block' : 'grid grid-cols-2 gap-2'}>
        {screenshots.map((screenshot, index) => (
          <Card
            as="button"
            key={screenshot.id}
            type="button"
            onClick={() => setLightboxIndex(index)}
            aria-label={`Увеличить скриншот ${screenshot.fileName}`}
            padding="none"
            interactive
            className="block w-full overflow-hidden"
          >
            <span className="relative group block w-full">
              <span className="absolute inset-0 bg-overlay/0 group-hover:bg-overlay/10 transition-colors flex items-center justify-center z-10">
                <span className="opacity-0 group-hover:opacity-100 transition-opacity text-on-inverse text-title drop-shadow">🔍</span>
              </span>
              <img
                src={urls[screenshot.id]}
                alt={screenshot.fileName}
                loading="lazy"
                className={
                  screenshots.length === 1
                    ? 'w-full object-contain rounded-card'
                    : 'w-full h-32 object-cover'
                }
                style={screenshots.length === 1 ? { maxHeight: '500px' } : undefined}
              />
            </span>
          </Card>
        ))}
      </div>

      {lightboxIndex !== null && (
        // ds-исключение: лайтбокс — не диалог с заголовком/текстом, а полноэкранный
        // просмотр изображения (свайпы, зум, стрелки поверх тёмного фона). Пакетный
        // Modal требует title и рисует свою шапку с крестиком — сюда не ложится.
        // Оставлено на местном ui/Modal.tsx (решение оркестратора 23.09.2026).
        <Modal
          open
          onClose={() => setLightboxIndex(null)}
          closeOnBackdrop={false}
          ariaLabel="Просмотр скриншота"
          overlayClassName="fixed inset-0 z-50 bg-overlay flex items-center justify-center"
          className="w-full h-full"
        >
          <div
            data-ds-exception="лайтбокс: полноэкранный просмотр изображения, не диалог"
            className="w-full h-full flex items-center justify-center"
            onClick={() => setLightboxIndex(null)}
          >
          <div className="absolute top-3 right-3 z-10">
            <Button
              onClick={() => setLightboxIndex(null)}
              variant="ghost"
              size="md"
              type="button"
              aria-label="Закрыть"
              icon={<X />}
            />
          </div>

          <div
            className="relative w-full h-full flex items-center justify-center overflow-hidden touch-none select-none"
            onClick={e => e.stopPropagation()}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onImageTouchEnd}
            onDoubleClick={handleDoubleActivate}
          >
            <img
              src={urls[screenshots[lightboxIndex].id]}
              alt={screenshots[lightboxIndex].fileName}
              draggable={false}
              className="max-w-full max-h-[88vh] object-contain rounded-card"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transition: gesture.current.mode === 'none' ? 'transform 0.15s ease-out' : 'none',
                cursor: zoom > 1 ? 'grab' : 'zoom-in',
              }}
            />
          </div>

          {screenshots.length > 1 && (
            <>
              <div className="absolute left-3 top-1/2 z-10 -translate-y-1/2">
                <Button
                  onClick={e => { e.stopPropagation(); goTo(lightboxIndex > 0 ? lightboxIndex - 1 : screenshots.length - 1); }}
                  variant="ghost"
                  size="md"
                  type="button"
                  aria-label="Предыдущий"
                  icon={<ChevronLeft />}
                />
              </div>
              <span
                className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-surface px-3 py-2 rounded-full text-body font-medium shadow-raised"
                onClick={e => e.stopPropagation()}
                data-ui-role="position-indicator"
              >
                {lightboxIndex + 1} / {screenshots.length}
              </span>
              <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
                <Button
                  onClick={e => { e.stopPropagation(); goTo(lightboxIndex < screenshots.length - 1 ? lightboxIndex + 1 : 0); }}
                  variant="ghost"
                  size="md"
                  type="button"
                  aria-label="Следующий"
                  icon={<ChevronRight />}
                />
              </div>
            </>
          )}
          </div>
        </Modal>
      )}
    </>
  );
}
