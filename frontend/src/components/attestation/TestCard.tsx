import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Send, ChevronRight } from 'lucide-react';
import { attestationApi } from '@/api/attestation';
import type { AttestationTest, AttestationAttempt } from '@/types';
import { Button, Badge, Card } from '@chirkov/shell';

const STATUS_LABEL: Record<AttestationTest['status'], string> = {
  generating: 'Собираем вопросы…',
  draft: 'Черновик, готов к назначению',
  active: 'Идёт',
  closed: 'Закрыта',
};

type AttemptBadgeColor = 'neutral' | 'accent' | 'success' | 'danger';

function attemptStatusLabel(a: AttestationAttempt): { text: string; color: AttemptBadgeColor } {
  if (a.status === 'graded') {
    return a.passed
      ? { text: `${a.totalScorePercent}% · сдал`, color: 'success' }
      : { text: `${a.totalScorePercent}% · не сдал`, color: 'danger' };
  }
  if (a.status === 'ai_graded') return { text: 'ждёт вашей проверки', color: 'accent' };
  if (a.status === 'submitted') return { text: 'оценивается…', color: 'neutral' };
  return { text: 'не начал', color: 'neutral' };
}

interface TestCardProps {
  test: AttestationTest;
  companyId: string;
  onChanged: () => void;
}

export function TestCard({ test, companyId, onChanged }: TestCardProps) {
  const [attempts, setAttempts] = useState<AttestationAttempt[]>([]);
  const [assigning, setAssigning] = useState(false);

  useEffect(() => {
    if (test.status === 'active' || test.status === 'closed') {
      attestationApi.listAttempts(companyId, test.id).then(({ data }) => setAttempts(data)).catch(() => {});
    }
  }, [test.id, test.status, companyId]);

  const handleAssign = async () => {
    setAssigning(true);
    try {
      await attestationApi.assign(companyId, test.id, {});
      toast.success('Аттестация назначена команде');
      onChanged();
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || 'Не удалось назначить', { duration: Infinity });
    } finally {
      setAssigning(false);
    }
  };

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading font-semibold text-fg">
            {test.title}
            {test.isQuiz && <span className="text-micro text-fg-subtle font-normal"> · короткий квиз</span>}
          </h3>
          <p className="text-micro text-fg-subtle mt-0.5">
            Проходной балл {test.passingScorePercent}% · {STATUS_LABEL[test.status]}
          </p>
        </div>
        {test.status === 'generating' && <Loader2 className="w-4 h-4 text-accent-focus animate-spin flex-shrink-0" />}
      </div>

      {test.status === 'draft' && (
        <Button
          onClick={handleAssign}
          disabled={assigning}
          variant="primary"
          size="md"
          icon={<Send />}
        >
          {assigning ? 'Назначаем…' : 'Назначить команде'}
        </Button>
      )}

      {test.status === 'draft' && test.generationError && (
        <p className="text-micro text-danger-fg">{test.generationError}</p>
      )}

      {(test.status === 'active' || test.status === 'closed') && attempts.length > 0 && (
        <div className="divide-y divide-border border-t border-border pt-2">
          {attempts.map((a) => {
            const s = attemptStatusLabel(a);
            const clickable = a.status === 'ai_graded' || a.status === 'graded';
            const content = (
              <>
                <span className="text-fg-muted">{a.user?.fullName ?? 'Сотрудник'}</span>
                <span className="flex items-center gap-1.5">
                  <Badge tone={s.color}>{s.text}</Badge>
                  {clickable && <ChevronRight className="w-3.5 h-3.5 text-border" />}
                </span>
              </>
            );
            const rowClass = 'flex items-center justify-between py-2 text-body hover:bg-canvas rounded-card px-1 -mx-1 transition-colors';
            return clickable ? (
              <Link key={a.id} to={`/attestation/review/${a.id}`} className={rowClass}>{content}</Link>
            ) : (
              <div key={a.id} className={rowClass}>{content}</div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
