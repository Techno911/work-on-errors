import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '@/components/layout/PageTitle';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { attestationApi } from '@/api/attestation';
import { Button, Textarea, Badge, Card } from '@chirkov/shell';
import type { AttestationQuestion } from '@/types';

const TYPE_LABEL: Record<AttestationQuestion['type'], string> = {
  knowledge: 'На знание правила',
  situation: 'Ситуация',
  practice: 'Рабочая проба',
};

export function AttestationTakePage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [questions, setQuestions] = useState<AttestationQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!attemptId) return;
    attestationApi.getForTaking(attemptId).then(({ data }) => {
      setTitle(data.attempt.test?.title ?? 'Аттестация');
      setQuestions(data.questions);
      const map: Record<string, string> = {};
      data.answers.forEach((a) => { map[a.questionId] = a.answerText; });
      setAnswers(map);
    }).catch(() => toast.error('Не удалось открыть аттестацию', { duration: Infinity }))
      .finally(() => setLoading(false));
  }, [attemptId]);

  const saveAnswer = useCallback(async (questionId: string, text: string) => {
    if (!attemptId) return;
    setSaving(questionId);
    try {
      await attestationApi.saveAnswer(attemptId, questionId, text);
    } catch {
      toast.error('Ответ не сохранился, попробуйте ещё раз');
    } finally {
      setSaving(null);
    }
  }, [attemptId]);

  const handleBlur = (questionId: string) => {
    const text = answers[questionId] ?? '';
    if (text.trim()) void saveAnswer(questionId, text);
  };

  const handleSubmit = async () => {
    if (!attemptId) return;
    const missing = questions.filter((q) => !answers[q.id]?.trim());
    if (missing.length) {
      toast.error(`Остались вопросы без ответа: ${missing.length} из ${questions.length}`);
      return;
    }
    setSubmitting(true);
    try {
      await attestationApi.submit(attemptId);
      toast.success('Аттестация отправлена. Результат придёт после проверки руководителем.');
      navigate('/attestation');
    } catch (e: unknown) {
      const message = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(message || 'Не удалось отправить', { duration: Infinity });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="space-y-4">{[1, 2, 3].map((i) => <div key={i} className="h-32 bg-surface-sunken rounded-card animate-pulse" />)}</div>;
  }

  const answeredCount = questions.filter((q) => answers[q.id]?.trim()).length;

  return (
    <div className="space-y-6 max-w-read">
      <div>
        <PageTitle text={title} />
        <p className="text-body text-fg-subtle mt-1">
          {questions.length} вопросов, без вариантов ответа. Отвечайте своими словами. Ответы сохраняются автоматически.
          Отправлено: {answeredCount} из {questions.length}.
        </p>
      </div>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <Card key={q.id} padding="md" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-micro font-medium text-fg-subtle">Вопрос {i + 1} из {questions.length}</span>
              <Badge tone="neutral">{TYPE_LABEL[q.type]}</Badge>
            </div>
            <p className="text-body text-fg">{q.questionText}</p>
              <Textarea resize="none"
              value={answers[q.id] ?? ''}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
              onBlur={() => handleBlur(q.id)}
              rows={3}
              placeholder="Ваш ответ…"
            />
            {saving === q.id && <p className="text-micro text-fg-subtle">Сохраняем…</p>}
          </Card>
        ))}
      </div>

      <Button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || answeredCount < questions.length}
        fullWidth
      >
        {submitting ? 'Отправляем…' : 'Отправить аттестацию'}
      </Button>
    </div>
  );
}
