import client from './client';
import type { AttestationTest, AttestationQuestion, AttestationAttempt, AttestationAnswer } from '@/types';

export interface AttemptReviewItem {
  question: AttestationQuestion;
  answer: AttestationAnswer | null;
}

export const attestationApi = {
  // РОП
  listTests: (companyId: string) => client.get<AttestationTest[]>('/attestation/tests', { params: { companyId } }),
  generateTest: (companyId: string, data: { title?: string; passingScorePercent?: number }) =>
    client.post<AttestationTest>('/attestation/tests', data, { params: { companyId } }),
  assign: (companyId: string, testId: string, data: { deadline?: string }) =>
    client.post<AttestationTest>(`/attestation/tests/${testId}/assign`, data, { params: { companyId } }),
  listAttempts: (companyId: string, testId: string) =>
    client.get<AttestationAttempt[]>(`/attestation/tests/${testId}/attempts`, { params: { companyId } }),
  getForReview: (companyId: string, attemptId: string) =>
    client.get<{ attempt: AttestationAttempt; items: AttemptReviewItem[] }>(`/attestation/attempts/${attemptId}/review`, { params: { companyId } }),
  gradeAnswer: (companyId: string, attemptId: string, questionId: string, reviewerScore: 0 | 1 | 2) =>
    client.put(`/attestation/attempts/${attemptId}/answers/${questionId}/grade`, { reviewerScore }, { params: { companyId } }),
  finalize: (companyId: string, attemptId: string) =>
    client.post<AttestationAttempt>(`/attestation/attempts/${attemptId}/finalize`, {}, { params: { companyId } }),
  retake: (companyId: string, attemptId: string) =>
    client.post<AttestationTest>(`/attestation/attempts/${attemptId}/retake`, {}, { params: { companyId } }),

  // Менеджер
  listMy: () => client.get<AttestationAttempt[]>('/attestation/my'),
  getForTaking: (attemptId: string) =>
    client.get<{ attempt: AttestationAttempt; questions: AttestationQuestion[]; answers: AttestationAnswer[] }>(`/attestation/attempts/${attemptId}/take`),
  saveAnswer: (attemptId: string, questionId: string, answerText: string) =>
    client.put(`/attestation/attempts/${attemptId}/answers/${questionId}`, { answerText }),
  submit: (attemptId: string) => client.post<AttestationAttempt>(`/attestation/attempts/${attemptId}/submit`, {}),
  getMyResult: (attemptId: string) =>
    client.get<{
      attempt: AttestationAttempt;
      test: AttestationTest;
      items: Array<{ questionText: string; type: AttestationQuestion['type']; referenceAnswer: string; answerText: string; reviewerScore: 0 | 1 | 2 | null }>;
    }>(`/attestation/attempts/${attemptId}/result`),
};
