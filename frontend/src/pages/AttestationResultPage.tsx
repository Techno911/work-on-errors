import { useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { attestationApi } from '@/api/attestation';
import { pluralRu } from '@/lib/utils';
import { Badge, Card } from '@chirkov/shell';

const REVIEWER_SCORE_BADGE_COLOR = {
  0: 'danger',
  1: 'warning',
  2: 'success',
} as const;

interface ResultData {
  attempt: { totalScorePercent: string | null; passed: boolean | null; failedCritical: boolean };
  test: { title: string; passingScorePercent: number };
  items: Array<{ questionText: string; referenceAnswer: string; answerText: string; reviewerScore: 0 | 1 | 2 | null }>;
}

export function AttestationResultPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [data, setData] = useState<ResultData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!attemptId) return;
    attestationApi.getMyResult(attemptId)
      .then(({ data }) => setData(data))
      .catch(() => setError('Результат ещё не готов: руководитель проверяет ответы'));
  }, [attemptId]);

  if (error) {
    return <p className="text-fg-subtle text-body">{error}</p>;
  }
  if (!data) {
    return <div className="h-32 bg-surface-sunken rounded-card animate-pulse" />;
  }

  return (
    <div className="space-y-6 max-w-read">
      <div className={`rounded-card p-6 flex items-center gap-4 ${data.attempt.passed ? 'bg-success-subtle' : 'bg-danger-subtle'}`}>
        {data.attempt.passed ? <CheckCircle2 className="w-10 h-10 text-success-fg flex-shrink-0" /> : <XCircle className="w-10 h-10 text-danger-fg flex-shrink-0" />}
        <div>
          <PageTitle text={data.test.title} />
          <p className={`text-body font-medium mt-0.5 ${data.attempt.passed ? 'text-success-fg' : 'text-danger-fg'}`}>
            {data.attempt.totalScorePercent}% · порог {data.test.passingScorePercent}% · {data.attempt.passed ? 'сдал' : 'не сдал'}
            {data.attempt.failedCritical && !data.attempt.passed && ' · есть критичная ошибка'}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-body font-semibold text-fg-muted uppercase tracking-overline">Разбор по вопросам</h2>
        {data.items.map((it, i) => (
          <Card key={i} padding="md" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-body font-medium text-fg min-w-0">{it.questionText}</p>
              {it.reviewerScore != null && (
                <Badge tone={REVIEWER_SCORE_BADGE_COLOR[it.reviewerScore]}>
                  {it.reviewerScore} {pluralRu(it.reviewerScore, 'балл', 'балла', 'баллов')}
                </Badge>
              )}
            </div>
            <p className="text-micro text-fg-subtle">Ваш ответ: {it.answerText}</p>
            <p className="text-micro text-fg-subtle">Правило: {it.referenceAnswer}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
