import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, Pencil, Archive, Clock, ThumbsDown, ThumbsUp, Sparkle } from 'lucide-react';
import { playbookApi } from '@/api/playbook';
import { PlaybookDismissDialog } from './PlaybookDismissDialog';
import type { PlaybookCard } from '@/types';
import { Button, Textarea, Card } from '@chirkov/shell';

interface PlaybookCardItemProps {
  card: PlaybookCard;
  companyId: string;
  canManage: boolean;
  onChanged: () => void;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function PlaybookCardItem({ card, companyId, canManage, onChanged }: PlaybookCardItemProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [ruleText, setRuleText] = useState(card.ruleText ?? '');
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await playbookApi.update(companyId, card.id, { ruleText });
      toast.success('Правило обновлено');
      setEditing(false);
      onChanged();
    } catch {
      toast.error('Не удалось сохранить правку', { duration: Infinity });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding="none" className="overflow-hidden">
      {/* Свёрнутая строка: кикер меты + название — раскрывается только по клику (закон вёрстки платформы) */}
      <Button
        onClick={() => setExpanded((v) => !v)}
        variant="ghost"
        size="sm"
        fullWidth
        aria-expanded={expanded}
      >
        <span className="flex items-center justify-between gap-3 w-full text-left font-normal">
        <span className="min-w-0">
          <p className="text-micro uppercase tracking-overline font-mono text-fg-subtle mb-0.5 flex items-center gap-1.5">
            {card.occurrenceCount} случа{card.occurrenceCount === 1 ? 'й' : card.occurrenceCount < 5 ? 'я' : 'ев'}
            {card.isOverdue && (
              <span className="inline-flex items-center gap-1 text-warning-fg">
                <Clock className="w-3 h-3" /> пора пересмотреть
              </span>
            )}
            {card.autoResolvedHint && (
              <span className="inline-flex items-center gap-1 text-success-fg">
                <Sparkle className="w-3 h-3" /> похоже, решено
              </span>
            )}
          </p>
          <p className="font-heading font-medium text-fg truncate">{card.title}</p>
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-fg-disabled flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-fg-disabled flex-shrink-0" />}
        </span>
      </Button>

      {expanded && (
        <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
          <div>
            <p className="text-micro font-medium text-fg-subtle uppercase tracking-overline mb-1">Как делаем у нас</p>
            {editing ? (
              <div className="space-y-2">
                  <Textarea resize="none"
                  value={ruleText}
                  onChange={(e) => setRuleText(e.target.value)}
                  rows={4}
                  maxLength={4000}
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={saving}
                    variant="primary"
                    size="sm"
                  >
                    {saving ? 'Сохраняем…' : 'Сохранить'}
                  </Button>
                  <Button
                    onClick={() => { setEditing(false); setRuleText(card.ruleText ?? ''); }}
                    variant="ghost"
                    size="sm"
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-body text-fg-muted">{card.ruleText || 'Правило не заполнено'}</p>
            )}
          </div>

          {card.examples.length > 0 && (
            <div className="space-y-2">
              <p className="text-micro font-medium text-fg-subtle uppercase tracking-overline">Примеры</p>
              {card.examples.map((ex, i) => (
                <div key={i} className="flex items-start gap-2 text-body">
                  {ex.kind === 'bad' ? (
                    <ThumbsDown className="w-3.5 h-3.5 text-danger mt-0.5 flex-shrink-0" />
                  ) : (
                    <ThumbsUp className="w-3.5 h-3.5 text-success-fg mt-0.5 flex-shrink-0" />
                  )}
                  <p className="text-fg-muted">«{ex.quote}»</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <p className="text-micro text-fg-subtle">
              {card.ownerName && <>Ведёт {card.ownerName} · </>}
              {card.confirmedAt && <>с {formatDate(card.confirmedAt)}</>}
            </p>
            {canManage && !editing && (
              <div className="flex gap-3">
                <Button
                  onClick={() => setEditing(true)}
                  variant="ghost"
                  size="sm"
                  icon={<Pencil />}
                >
                  Править
                </Button>
                <Button
                  onClick={() => setArchiving(true)}
                  variant="ghost"
                  size="sm"
                  icon={<Archive />}
                >
                  Убрать
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {archiving && (
        <PlaybookDismissDialog
          card={card}
          companyId={companyId}
          mode="archive"
          onClose={() => setArchiving(false)}
          onDone={() => { setArchiving(false); onChanged(); }}
        />
      )}
    </Card>
  );
}
