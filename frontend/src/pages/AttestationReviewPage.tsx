import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check, Wand2, RotateCcw } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { attestationApi, type AttemptReviewItem } from '@/api/attestation';
import type { AttestationAttempt } from '@/types';
import { Button, Badge, Card } from '@chirkov/shell';

const TYPE_LABEL: Record<string, string> = { knowledge: 'На знание правила', situation: 'Ситуация', practice: 'Рабочая проба' };
const SCORE_LABEL: Record<0 | 1 | 2, string> = { 0: 'Не по правилу', 1: 'Частично', 2: 'Полностью по правилу' };

export function AttestationReviewPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const companyId = user?.companyId ?? '';

  const [attempt, setAttempt] = useState<AttestationAttempt | null>(null);
  const [items, setItems] = useState<AttemptReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);

  const load = useCallback(async () => {
    if (!attemptId) return;
    const { data } = await attestationApi.getForReview(companyId, attemptId);
    setAttempt(data.attempt);
    setItems(data.items);
    setLoading(false);
  }, [attemptId, companyId]);

  useEffect(() => { load(); }, [load]);

  const setScore = async (questionId: string, score: 0 | 1 | 2) => {
    if (!attemptId) return;
    setItems((prev) => prev.map((it) => it.question.id === questionId
      ? { ...it, answer: it.answer ? { ...it.answer, reviewerScore: score } : { questionId, answerText: '', reviewerScore: score } }
      : it));
    try {
      await attestationApi.gradeAnswer(companyId, attemptId, questionId, score);
    } catch {
      toast.error('Балл не сохранился, попробуйте ещё раз');
      load();
    }
  };

  const graded = items.filter((it) => it.answer?.reviewerScore != null).length;
  const allGraded = items.length > 0 && graded === items.length;

  const handleFinalize = async () => {
    if (!attemptId) return;
    setFinalizing(true);
    try {
      const { data } = await attestationApi.finalize(companyId, attemptId);
      toast.success(data.passed ? `Сдал: ${data.totalScorePercent}%` : `Не сдал: ${data.totalScorePercent}%`);
      navigate('/attestation');
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || 'Не удалось завершить проверку', { duration: Infinity });
    } finally {
      setFinalizing(false);
    }
  };

  const handleRetake = async () => {
    if (!attemptId) return;
    try {
      await attestationApi.retake(companyId, attemptId);
      toast.success('Пересдача назначена: соберётся вторая форма теста');
      navigate('/attestation');
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || 'Не удалось назначить пересдачу', { duration: Infinity });
    }
  };

  if (loading || !attempt) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-32 bg-surface-sunken rounded-card animate-pulse" />)}</div>;
  }

  return (
    <div className="space-y-6 max-w-read">
      <div>
        <PageTitle text={`Проверка ответов · ${attempt.user?.fullName ?? 'Сотрудник'}`} />
        <p className="text-body text-fg-subtle mt-1">
          Платформа предложила балл по каждому ответу с обоснованием. Согласитесь или поставьте свой.
          Оценено {graded} из {items.length}.
        </p>
      </div>

      <div className="space-y-4">
        {items.map(({ question, answer }, i) => (
          <Card key={question.id} padding="md" className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-micro font-medium text-fg-subtle">Вопрос {i + 1} из {items.length}</span>
              <Badge tone="neutral">{TYPE_LABEL[question.type] ?? question.type}</Badge>
              {question.isCritical && <Badge tone="danger">критичный</Badge>}
            </div>
            <p className="text-body font-medium text-fg">{question.questionText}</p>

            <div className="rounded-block bg-canvas p-3 text-micro text-fg-subtle">
              <span className="font-medium uppercase tracking-overline">Эталон:</span> {question.referenceAnswer}
            </div>

            <div className="rounded-block border border-border p-3">
              <p className="text-micro font-medium text-fg-subtle uppercase tracking-overline mb-1">Ответ сотрудника</p>
              <p className="text-body text-fg-muted">{answer?.answerText || 'нет ответа'}</p>
            </div>

            {answer?.aiSuggestedScore != null && (
              <div className="rounded-block border border-accent-muted bg-accent-subtle p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Wand2 className="w-3.5 h-3.5 text-accent" />
                  <p className="text-micro font-medium text-accent-fg">Платформа предлагает: {answer.aiSuggestedScore} балл{answer.aiSuggestedScore === 1 ? '' : 'а'}</p>
                </div>
                {answer.aiSuggestedReasoning && <p className="text-micro text-accent-fg-deep">{answer.aiSuggestedReasoning}</p>}
              </div>
            )}

            <div className="flex items-center gap-3 pt-1">
              <span className="text-micro text-fg-subtle mr-1">Ваша оценка:</span>
              {([0, 1, 2] as const).map((score) => (
                <Button
                  type="button"
                  variant={answer?.reviewerScore === score ? 'primary' : 'secondary'}
                  size="sm"
                  key={score}
                  onClick={() => setScore(question.id, score)}
                  title={SCORE_LABEL[score]}
                >
                  {score}
                </Button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {attempt.status !== 'graded' ? (
        <Button
          type="button"
          onClick={handleFinalize}
          disabled={!allGraded || finalizing}
          fullWidth
          icon={<Check />}
        >
          {finalizing ? 'Завершаем…' : 'Завершить проверку'}
        </Button>
      ) : !attempt.passed ? (
        <Button variant="secondary" size="md" fullWidth
          onClick={handleRetake}
          icon={<RotateCcw />}
        >
          Назначить пересдачу (вторая форма)
        </Button>
      ) : null}
    </div>
  );
}
