import { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { Button, Badge } from '@chirkov/shell';

interface TranscriptionViewProps {
  text: string;
}

interface Reply {
  speaker: number | null;
  timecode: string | null;
  text: string;
}

// Палитра фонов реплик по говорящему (чередование делает диалог читаемым).
const SPEAKER_BG = ['bg-canvas', 'bg-accent-subtle', 'bg-info-subtle', 'bg-success-subtle'];

// «[02:14] Голос 1: текст» → { speaker: 1, timecode: '02:14', text }.
// Строки без префикса (старые транскрипции, ручной ввод) отдаём как есть.
function parseReplies(text: string): Reply[] {
  const blocks = text.split(/\n\n+/).map(b => b.trim()).filter(Boolean);
  return blocks.map((block): Reply => {
    const m = block.match(/^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?Голос\s+(\d+):\s*([\s\S]*)$/);
    if (!m) return { speaker: null, timecode: null, text: block };
    return { speaker: parseInt(m[2], 10), timecode: m[1] ?? null, text: m[3].trim() };
  });
}

export function TranscriptionView({ text }: TranscriptionViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const replies = useMemo(() => parseReplies(text), [text]);
  const hasSpeakers = replies.some(r => r.speaker !== null);
  const isLong = text.length > 800 || replies.length > 8;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать', { duration: Infinity });
    }
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <Button
          variant="link"
          size="sm"
          type="button"
          onClick={handleCopy}
          title="Скопировать транскрипцию"
          icon={copied ? <Check className="text-success" /> : <Copy />}
        >
          {copied ? 'Скопировано' : 'Копировать'}
        </Button>
      </div>

      <div
        className="relative overflow-hidden rounded-card"
        style={{ maxHeight: expanded ? 'none' : '320px' }}
      >
        {hasSpeakers ? (
          <div className="space-y-2">
            {replies.map((r, i) => (
              <div
                key={i}
                className={`rounded-card px-3 py-2 ${
                  r.speaker !== null ? SPEAKER_BG[(r.speaker - 1) % SPEAKER_BG.length] : 'bg-canvas'
                }`}
              >
                {r.speaker !== null && (
                  <div className="flex items-center gap-2 mb-1">
                    <Badge tone="neutral">Голос {r.speaker}</Badge>
                    {r.timecode && (
                      <span className="text-micro font-mono text-fg-subtle tabular-nums">{r.timecode}</span>
                    )}
                  </div>
                )}
                <p className="text-body-lg sm:text-body text-fg-muted whitespace-pre-wrap">{r.text}</p>
              </div>
            ))}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap text-body-lg sm:text-body text-fg-muted font-mono">
            {text}
          </pre>
        )}
        {/* Gradient fade signals there's more content below */}
        {isLong && !expanded && (
          <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-on-inverse to-transparent pointer-events-none" />
        )}
      </div>

      {isLong && (
        <div className={expanded ? 'flex justify-center mt-2' : 'mt-1'}>
          <Button
            variant={expanded ? 'secondary' : 'link'}
            size="sm"
            onClick={() => setExpanded(v => !v)}
            type="button"
          >
            {expanded ? '▲ Свернуть' : '▼ Показать полностью'}
          </Button>
        </div>
      )}
    </div>
  );
}
