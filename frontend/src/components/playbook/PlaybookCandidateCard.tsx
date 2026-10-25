import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, Check, X, ExternalLink, Wand2 } from 'lucide-react';
import { PlaybookTrendBadge } from './PlaybookTrendBadge';
import { PlaybookConfirmDialog } from './PlaybookConfirmDialog';
import { PlaybookDismissDialog } from './PlaybookDismissDialog';
import { Button, Card } from '@chirkov/shell';
import type { PlaybookCard } from '@/types';

interface PlaybookCandidateCardProps {
  candidate: PlaybookCard;
  companyId: string;
  onResolved: () => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export function PlaybookCandidateCard({ candidate, companyId, onResolved }: PlaybookCandidateCardProps) {
  const [dialog, setDialog] = useState<'confirm' | 'dismiss' | null>(null);

  return (
    <Card padding="none" tone="accent" elevation="raised" className="overflow-hidden">
      <div className="px-5 py-3 bg-accent-subtle border-b border-accent-subtle-hover flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-accent flex-shrink-0" />
        <p className="text-micro font-medium text-accent-fg">
          {candidate.detectionSource === 'semantic'
            ? 'Платформа заметила похожую формулировку в нескольких разборах: нужно ваше решение'
            : 'Платформа заметила повтор: нужно ваше решение'}
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-heading font-semibold text-fg">{candidate.title}</h3>
          <PlaybookTrendBadge trend={candidate.trend} occurrenceCount={candidate.occurrenceCount} />
        </div>

        {candidate.draftRuleText && (
          <Card padding="sm" surface="canvas" radius="block">
            <div className="flex items-center gap-1.5 mb-1">
              <Wand2 className="w-3.5 h-3.5 text-fg-disabled" />
              <p className="text-micro font-medium text-fg-subtle uppercase tracking-overline">Черновик правила от платформы</p>
            </div>
            <p className="text-body text-fg-muted">{candidate.draftRuleText}</p>
          </Card>
        )}

        <div className="space-y-2">
          <p className="text-micro font-medium text-fg-subtle uppercase tracking-overline">Доказательства из ваших же разборов</p>
          {candidate.evidence.length === 0 && (
            <p className="text-body text-fg-subtle">Разборы найдены, но в них нет текста ревью для цитаты.</p>
          )}
          {candidate.evidence.map((ev) => (
            <div key={ev.entryId} className="border-l-2 border-accent-muted pl-3 py-1">
              <p className="text-body text-fg-muted">«{ev.reviewSnippet || 'Без текста ревью'}»</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-micro text-fg-subtle">
                  Разбор от {formatDate(ev.entryDate)} · {ev.managerName} · запись №{ev.entryNumber}
                </span>
                <Link
                  to={`/sprint/${ev.sprintId}?entryId=${ev.entryId}`}
                  className="text-micro text-accent-hover hover:underline inline-flex items-center gap-0.5"
                >
                  Открыть <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2 pt-1">
          <div className="flex-1">
            <Button
              onClick={() => setDialog('confirm')}
              variant="primary"
              size="md"
              fullWidth
              icon={<Check />}
            >
              Добавить в методичку
            </Button>
          </div>
          <Button
            onClick={() => setDialog('dismiss')}
            variant="secondary"
            size="md"
            icon={<X />}
          >
            Не системная ошибка
          </Button>
        </div>
      </div>

      {dialog === 'confirm' && (
        <PlaybookConfirmDialog
          card={candidate}
          companyId={companyId}
          onClose={() => setDialog(null)}
          onConfirmed={() => { setDialog(null); onResolved(); }}
        />
      )}
      {dialog === 'dismiss' && (
        <PlaybookDismissDialog
          card={candidate}
          companyId={companyId}
          mode="dismiss"
          onClose={() => setDialog(null)}
          onDone={() => { setDialog(null); onResolved(); }}
        />
      )}
    </Card>
  );
}
