import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AttestationTest, AttestationTestStatus } from './entities/attestation-test.entity';
import { AttestationQuestion, AttestationQuestionType } from './entities/attestation-question.entity';
import { AttestationAttempt, AttestationAttemptStatus } from './entities/attestation-attempt.entity';
import { AttestationAnswer } from './entities/attestation-answer.entity';
import { PlaybookCard, PlaybookCardStatus } from '../playbook/entities/playbook-card.entity';
import { OllamaService } from '../llm/ollama.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/enums/user-role.enum';
import { GenerateTestDto } from './dto/attestation.dto';
import { computeAttemptResult, parseGeneratedQuestions, parseGradedAnswer, discardTooShort, ScoredAnswer } from './attestation.util';

// Сколько карточек методички берём в один тест — план ориентируется на 20 вопросов без
// вариантов ответа (стандарт обучения платформы); при трёх вопросах на карточку 7 карточек
// дают 21 вопрос, близко к цели, и укладывается в разумное время фоновой генерации на CPU.
const MAX_CARDS_PER_TEST = 7;
const WEIGHTS: Record<AttestationQuestionType, number> = { knowledge: 1, situation: 2, practice: 3 };

@Injectable()
export class AttestationService {
  private readonly logger = new Logger(AttestationService.name);

  constructor(
    @InjectRepository(AttestationTest) private readonly testRepo: Repository<AttestationTest>,
    @InjectRepository(AttestationQuestion) private readonly questionRepo: Repository<AttestationQuestion>,
    @InjectRepository(AttestationAttempt) private readonly attemptRepo: Repository<AttestationAttempt>,
    @InjectRepository(AttestationAnswer) private readonly answerRepo: Repository<AttestationAnswer>,
    @InjectRepository(PlaybookCard) private readonly cardRepo: Repository<PlaybookCard>,
    private readonly ollama: OllamaService,
    private readonly notificationsService: NotificationsService,
    private readonly usersService: UsersService,
  ) {}

  // ───────────────────────── РОП: создание и назначение теста ─────────────────────────

  async listTests(companyId: string) {
    return this.testRepo.find({ where: { companyId }, order: { createdAt: 'DESC' } });
  }

  async generateTest(companyId: string, dto: GenerateTestDto, userId: string): Promise<AttestationTest> {
    const cards = await this.cardRepo.find({
      where: { companyId, status: PlaybookCardStatus.ACTIVE },
      order: { occurrenceCount: 'DESC' },
      take: MAX_CARDS_PER_TEST,
    });
    if (!cards.length) {
      throw new BadRequestException('В методичке пока нет ни одной активной карточки — вопросы генерировать не из чего');
    }

    const test = await this.testRepo.save(this.testRepo.create({
      companyId,
      title: dto.title?.trim() || `Аттестация по методичке · ${new Date().toLocaleDateString('ru-RU')}`,
      status: AttestationTestStatus.GENERATING,
      passingScorePercent: dto.passingScorePercent ?? 75,
      createdBy: userId,
    }));

    void this.generateQuestionsAsync(test.id, cards, false).catch((e) => {
      this.logger.warn(`Генерация вопросов теста ${test.id} упала: ${(e as Error).message}`);
    });

    return test;
  }

  /** Release 4: короткий квиз (1-2 карточки) вместо полной аттестации, планировщик назначает
   *  его сам, без ручного шага РОПа — план: «навык растёт от частоты, не от разовых проверок». */
  async generateAndAssignQuiz(companyId: string): Promise<AttestationTest | null> {
    const cards = await this.cardRepo.find({
      where: { companyId, status: PlaybookCardStatus.ACTIVE },
      order: { lastOccurrenceAt: 'DESC' },
      take: 2,
    });
    if (!cards.length) return null;

    const test = await this.testRepo.save(this.testRepo.create({
      companyId,
      title: `Короткий квиз · ${new Date().toLocaleDateString('ru-RU')}`,
      status: AttestationTestStatus.GENERATING,
      passingScorePercent: 75,
      createdBy: 'system',
      isQuiz: true,
    }));
    void this.generateQuestionsAsync(test.id, cards, true).catch((e) => {
      this.logger.warn(`Генерация квиза ${test.id} упала: ${(e as Error).message}`);
    });
    return test;
  }

  private async generateQuestionsAsync(testId: string, cards: PlaybookCard[], autoAssign: boolean): Promise<void> {
    let order = 0;
    let created = 0;
    for (const card of cards) {
      if (!card.ruleText) continue;
      const badExample =
        card.examples.find((e) => e.kind === 'bad')?.quote ?? card.evidence[0]?.reviewSnippet ?? null;
      const raw = await this.ollama.generate(this.buildQuestionsPrompt(card.ruleText, badExample), { maxTokens: 400 });
      if (!raw) continue;
      const parsed = discardTooShort(parseGeneratedQuestions(raw));
      const goodExample = card.examples.find((e) => e.kind === 'good')?.quote;
      const referenceAnswer = goodExample ? `${card.ruleText} Пример: «${goodExample}»` : card.ruleText;
      // Ошибка ещё не решена (тренд не падает) — применение правила проверяем как критичное:
      // провал здесь не должен теряться в среднем балле теста.
      const isCritical = card.trend !== 'decreasing';

      // Квиз короткий (план: «5 вопросов раз в неделю») — одна ситуация на карточку,
      // не все три слоя, иначе 2 карточки уже дают полноценную аттестацию.
      const rows: Array<{ type: AttestationQuestionType; text: string | null }> = autoAssign
        ? [{ type: 'situation', text: parsed.situation ?? parsed.knowledge }]
        : [
          { type: 'knowledge', text: parsed.knowledge },
          { type: 'situation', text: parsed.situation },
          { type: 'practice', text: parsed.practice },
        ];
      for (const row of rows) {
        if (!row.text) continue;
        await this.questionRepo.save(this.questionRepo.create({
          testId,
          cardId: card.id,
          type: row.type,
          isCritical: isCritical && row.type !== 'knowledge',
          weight: WEIGHTS[row.type],
          questionText: row.text,
          referenceAnswer,
          sortOrder: order++,
        }));
        created++;
      }
    }
    await this.testRepo.update({ id: testId }, {
      status: AttestationTestStatus.DRAFT,
      generationError: created === 0
        ? 'Сервис ИИ был недоступен, ни один вопрос не сгенерировался. Попробуйте создать тест снова.'
        : null,
    });
    if (autoAssign && created > 0) {
      const test = await this.testRepo.findOne({ where: { id: testId } });
      if (test) await this.doAssign(test, null);
    }
  }

  private buildQuestionsPrompt(ruleText: string, badExample: string | null): string {
    return (
      'Ты помощник руководителя отдела продаж, готовишь аттестацию сотрудников по методичке компании. ' +
      'Есть утверждённое правило из методички:\n' +
      `ПРАВИЛО: ${ruleText}\n` +
      (badExample ? `ПРИМЕР ОШИБКИ ИЗ РАЗБОРА: ${badExample}\n` : '') +
      '\nСформулируй три вопроса для проверки сотрудника по этому правилу, БЕЗ вариантов ответа. ' +
      'Работай только с текстом правила выше, не добавляй общих советов про продажи.\n' +
      'Каждая метка встречается РОВНО ОДИН РАЗ. Не предлагай несколько вариантов вопроса и не ' +
      'повторяй метки — сразу останавливайся после текста вопроса «ПРОБА».\n' +
      'СИТУАЦИЯ и ПРОБА обязаны САМИ содержать описание ситуации — сотрудник видит только текст ' +
      'после метки и ничего кроме него, поэтому нельзя ограничиться вопросом «что вы ответите?» ' +
      'без ситуации перед ним. Пиши каждую как один сплошной абзац без пустой строки внутри.\n' +
      'Ответь строго в этом формате:\n' +
      'ЗНАНИЕ: вопрос на пересказ правила своими словами, одна строка\n' +
      'СИТУАЦИЯ: реплика клиента с конкретными деталями разговора и вопрос "что вы ответите", ' +
      'два-три предложения одним абзацем\n' +
      'ПРОБА: более развёрнутый кейс с деталями, где нужно применить правило на практике, ' +
      'тоже одним абзацем с вопросом в конце'
    );
  }

  async assign(testId: string, companyId: string, deadline: string | undefined): Promise<AttestationTest> {
    const test = await this.findTestScoped(testId, companyId);
    if (test.status !== AttestationTestStatus.DRAFT) {
      throw new BadRequestException('Назначить можно только готовый черновик теста');
    }
    await this.doAssign(test, deadline ?? null);
    return this.findTestScoped(testId, companyId);
  }

  /** Общая механика назначения — используется и ручным «Назначить команде», и авто-квизом. */
  private async doAssign(test: AttestationTest, deadline: string | null): Promise<void> {
    const questionCount = await this.questionRepo.count({ where: { testId: test.id } });
    if (!questionCount) {
      this.logger.warn(`Тест ${test.id}: назначать нечего, вопросов 0`);
      return;
    }
    const users = await this.usersService.findAll(test.companyId);
    const managers = users.filter((u) => u.role === UserRole.MANAGER);
    if (!managers.length) return;

    await this.testRepo.update({ id: test.id }, { status: AttestationTestStatus.ACTIVE, deadline });

    for (const m of managers) {
      const exists = await this.attemptRepo.findOne({ where: { testId: test.id, userId: m.id } });
      if (exists) continue;
      await this.attemptRepo.save(this.attemptRepo.create({ testId: test.id, userId: m.id, status: AttestationAttemptStatus.ASSIGNED }));
      await this.notificationsService.create({
        userId: m.id,
        type: NotificationType.ATTESTATION_ASSIGNED,
        title: test.isQuiz ? 'Короткий квиз по методичке' : 'Назначена аттестация по методичке',
        message: test.isQuiz
          ? `«${test.title}»: ${questionCount} вопрос${questionCount === 1 ? '' : 'а'}, пара минут.`
          : `«${test.title}»: ${questionCount} вопросов, ${deadline ? `дедлайн ${deadline}` : 'без жёсткого срока'}.`,
        relatedId: test.id,
        linkUrl: '/attestation',
      });
    }
  }

  async listAttempts(testId: string, companyId: string) {
    await this.findTestScoped(testId, companyId);
    return this.attemptRepo.find({ where: { testId }, relations: ['user'], order: { createdAt: 'ASC' } });
  }

  private async findTestScoped(id: string, companyId: string): Promise<AttestationTest> {
    const test = await this.testRepo.findOne({ where: { id, companyId } });
    if (!test) throw new NotFoundException('Тест аттестации не найден');
    return test;
  }

  // ───────────────────────── Менеджер: прохождение ─────────────────────────

  async listMyAttempts(userId: string) {
    return this.attemptRepo.find({ where: { userId }, relations: ['test'], order: { createdAt: 'DESC' } });
  }

  async getAttemptForTaking(attemptId: string, userId: string) {
    const attempt = await this.findAttemptOwnedBy(attemptId, userId);
    const questions = await this.questionRepo.find({ where: { testId: attempt.testId }, order: { sortOrder: 'ASC' } });
    const answers = await this.answerRepo.find({ where: { attemptId } });
    if (attempt.status === AttestationAttemptStatus.ASSIGNED) {
      attempt.status = AttestationAttemptStatus.ASSIGNED; // no-op, startedAt проставляем ниже
      await this.attemptRepo.update({ id: attemptId }, { startedAt: attempt.startedAt ?? new Date() });
    }
    return {
      attempt,
      // Эталон намеренно не отдаём сотруднику — иначе аттестация проверяет память на подсказку,
      // а не применение правила.
      questions: questions.map((q) => ({ id: q.id, type: q.type, questionText: q.questionText, sortOrder: q.sortOrder })),
      answers: answers.map((a) => ({ questionId: a.questionId, answerText: a.answerText })),
    };
  }

  async saveAnswer(attemptId: string, questionId: string, answerText: string, userId: string): Promise<void> {
    const attempt = await this.findAttemptOwnedBy(attemptId, userId);
    if (attempt.status !== AttestationAttemptStatus.ASSIGNED) {
      throw new BadRequestException('Тест уже отправлен, ответы больше не редактируются');
    }
    const existing = await this.answerRepo.findOne({ where: { attemptId, questionId } });
    if (existing) {
      existing.answerText = answerText;
      await this.answerRepo.save(existing);
    } else {
      await this.answerRepo.save(this.answerRepo.create({ attemptId, questionId, answerText }));
    }
  }

  async submit(attemptId: string, userId: string): Promise<AttestationAttempt> {
    const attempt = await this.findAttemptOwnedBy(attemptId, userId);
    if (attempt.status !== AttestationAttemptStatus.ASSIGNED) {
      throw new BadRequestException('Тест уже отправлен');
    }
    const questions = await this.questionRepo.find({ where: { testId: attempt.testId } });
    const answers = await this.answerRepo.find({ where: { attemptId } });
    const answered = new Set(answers.filter((a) => a.answerText.trim()).map((a) => a.questionId));
    const missing = questions.filter((q) => !answered.has(q.id));
    if (missing.length) {
      throw new BadRequestException(`Остались вопросы без ответа: ${missing.length} из ${questions.length}`);
    }

    attempt.status = AttestationAttemptStatus.SUBMITTED;
    attempt.submittedAt = new Date();
    await this.attemptRepo.save(attempt);

    void this.gradeAnswersAsync(attemptId).catch((e) => {
      this.logger.warn(`ИИ-оценка попытки ${attemptId} упала: ${(e as Error).message}`);
    });

    return attempt;
  }

  private async findAttemptOwnedBy(attemptId: string, userId: string): Promise<AttestationAttempt> {
    const attempt = await this.attemptRepo.findOne({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException('Попытка не найдена');
    if (attempt.userId !== userId) throw new ForbiddenException();
    return attempt;
  }

  /** Менеджер смотрит СВОЙ уже проверенный результат — с разбором по вопросам, эталоном и
   *  баллом, который выставил РОП. Пока попытка не graded, результат не показываем: до этого
   *  момента aiSuggestedScore — черновик платформы, а не решение. */
  async getMyResult(attemptId: string, userId: string) {
    const attempt = await this.findAttemptOwnedBy(attemptId, userId);
    if (attempt.status !== AttestationAttemptStatus.GRADED) {
      throw new BadRequestException('Результат ещё не готов — руководитель проверяет ответы');
    }
    const test = await this.testRepo.findOne({ where: { id: attempt.testId } });
    const questions = await this.questionRepo.find({ where: { testId: attempt.testId }, order: { sortOrder: 'ASC' } });
    const answers = await this.answerRepo.find({ where: { attemptId } });
    const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
    return {
      attempt,
      test,
      items: questions.map((q) => ({
        questionText: q.questionText,
        type: q.type,
        referenceAnswer: q.referenceAnswer,
        answerText: byQuestion.get(q.id)?.answerText ?? '',
        reviewerScore: byQuestion.get(q.id)?.reviewerScore ?? null,
      })),
    };
  }

  // ───────────────────────── Release 3: ИИ предлагает баллы ─────────────────────────

  private async gradeAnswersAsync(attemptId: string): Promise<void> {
    const answers = await this.answerRepo.find({ where: { attemptId } });
    for (const answer of answers) {
      const question = await this.questionRepo.findOne({ where: { id: answer.questionId } });
      if (!question) continue;
      const raw = await this.ollama.generate(this.buildGradePrompt(question.questionText, question.referenceAnswer, answer.answerText), { maxTokens: 200 });
      if (!raw) continue;
      const { score, reasoning } = parseGradedAnswer(raw);
      if (score === null) continue;
      answer.aiSuggestedScore = score;
      answer.aiSuggestedReasoning = reasoning;
      await this.answerRepo.save(answer);
    }
    const attempt = await this.attemptRepo.findOne({ where: { id: attemptId } });
    if (!attempt) return;
    attempt.status = AttestationAttemptStatus.AI_GRADED;
    await this.attemptRepo.save(attempt);

    const test = await this.testRepo.findOne({ where: { id: attempt.testId } });
    if (!test) return;
    const user = await this.usersService.findAll(test.companyId);
    const reviewers = user.filter((u) => u.role === UserRole.REVIEWER || u.role === UserRole.OWNER);
    const manager = user.find((u) => u.id === attempt.userId);
    for (const r of reviewers) {
      await this.notificationsService.create({
        userId: r.id,
        type: NotificationType.ATTESTATION_READY_TO_REVIEW,
        title: 'Ответы на аттестацию готовы к проверке',
        message: `${manager?.fullName ?? 'Сотрудник'} сдал «${test.title}», платформа предложила баллы — проверьте.`,
        relatedId: attempt.id,
        linkUrl: '/attestation',
      });
    }
  }

  private buildGradePrompt(question: string, referenceAnswer: string, employeeAnswer: string): string {
    return (
      'Ты помощник руководителя отдела продаж, проверяешь ответ сотрудника на аттестации по методичке. ' +
      'Оцени ответ по шкале 0 (не по правилу) / 1 (частично, узнал тему, но нарушил правило или упустил важное) / ' +
      '2 (полностью по правилу). Если ответ прямо ПРОТИВОРЕЧИТ правилу — предлагает делать именно то, ' +
      'что правило запрещает (например скидку там, где правило требует назвать причины, а не снижать цену) — ' +
      'это 0, а не 1, даже если сотрудник верно определил тему разговора. Балл 1 — только для ответа, который ' +
      'НЕ противоречит правилу, а лишь неполно его выполняет. Работай только с текстом ниже.\n\n' +
      `ВОПРОС: ${question}\n` +
      `ЭТАЛОН (правило из методички): ${referenceAnswer}\n` +
      `ОТВЕТ СОТРУДНИКА: ${employeeAnswer}\n\n` +
      'Ответь строго в формате:\n' +
      'БАЛЛ: 0, 1 или 2\n' +
      'ПОЧЕМУ: одно-два предложения, что совпало и что разошлось с эталоном'
    );
  }

  // ───────────────────────── РОП: проверка ответов ─────────────────────────

  async getAttemptForReview(attemptId: string, companyId: string) {
    // relations:['user'] здесь ЛОМАЛ каждый вызов до миграции v7.7.3: миграция v7.6.0 создала
    // attestation_attempts."userId" как varchar вместо uuid (копипаста), и LEFT JOIN на
    // users.id (uuid) падал «operator does not exist: uuid = character varying». Колонка
    // теперь uuid (v7.7.3), но relations грузим раздельно и после фикса — дешевле, чем
    // держать зависимость на JOIN ради одной записи.
    const attempt = await this.attemptRepo.findOne({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException('Попытка не найдена');
    const test = await this.testRepo.findOne({ where: { id: attempt.testId } });
    if (!test || test.companyId !== companyId) throw new NotFoundException('Попытка не найдена');
    attempt.test = test;
    attempt.user = await this.usersService.findById(attempt.userId);
    const questions = await this.questionRepo.find({ where: { testId: attempt.testId }, order: { sortOrder: 'ASC' } });
    const answers = await this.answerRepo.find({ where: { attemptId } });
    const byQuestion = new Map(answers.map((a) => [a.questionId, a]));
    return {
      attempt,
      items: questions.map((q) => ({ question: q, answer: byQuestion.get(q.id) ?? null })),
    };
  }

  async gradeAnswer(attemptId: string, questionId: string, companyId: string, reviewerScore: 0 | 1 | 2): Promise<void> {
    const { attempt } = await this.getAttemptForReview(attemptId, companyId);
    if (attempt.status !== AttestationAttemptStatus.AI_GRADED && attempt.status !== AttestationAttemptStatus.GRADED) {
      throw new BadRequestException('Сотрудник ещё не сдал эту попытку');
    }
    const answer = await this.answerRepo.findOne({ where: { attemptId, questionId } });
    if (!answer) throw new NotFoundException('Ответ не найден');
    answer.reviewerScore = reviewerScore;
    await this.answerRepo.save(answer);
  }

  async finalize(attemptId: string, companyId: string, userId: string): Promise<AttestationAttempt> {
    const { attempt, items } = await this.getAttemptForReview(attemptId, companyId);
    const ungraded = items.filter((i) => i.answer?.reviewerScore == null);
    if (ungraded.length) {
      throw new BadRequestException(`Не проставлен балл ещё для ${ungraded.length} ответов`);
    }
    const test = await this.testRepo.findOne({ where: { id: attempt.testId } });
    const scored: ScoredAnswer[] = items.map((i) => ({
      score: i.answer!.reviewerScore as 0 | 1 | 2,
      weight: i.question.weight,
      isCritical: i.question.isCritical,
    }));
    const result = computeAttemptResult(scored, test?.passingScorePercent ?? 75);

    attempt.status = AttestationAttemptStatus.GRADED;
    attempt.gradedAt = new Date();
    attempt.gradedBy = userId;
    attempt.totalScorePercent = String(result.totalScorePercent);
    attempt.passed = result.passed;
    attempt.failedCritical = result.failedCritical;
    await this.attemptRepo.save(attempt);

    await this.notificationsService.create({
      userId: attempt.userId,
      type: NotificationType.ATTESTATION_RESULT,
      title: result.passed ? 'Аттестация сдана' : 'Результат аттестации',
      message: result.passed
        ? `«${test?.title}»: ${result.totalScorePercent}%, порог пройден.`
        : `«${test?.title}»: ${result.totalScorePercent}%${result.failedCritical ? ', есть критичная ошибка' : ''}. Разбор доступен, будет назначена пересдача.`,
      relatedId: attempt.id,
      linkUrl: '/attestation',
    });

    return attempt;
  }

  /** Пересдача: новый тест «вторая форма» на том же наборе карточек — план: «нельзя по той же
   *  версии, иначе это проверка памяти на конкретные вопросы». Формулировки вопросов
   *  генерируются заново (другой прогон модели), эталон остаётся тем же утверждённым правилом. */
  async createRetake(originalAttemptId: string, companyId: string, userId: string): Promise<AttestationTest> {
    // Та же история с userId-колонкой, что в getAttemptForReview — relations грузим отдельно.
    const attempt = await this.attemptRepo.findOne({ where: { id: originalAttemptId } });
    if (!attempt) throw new NotFoundException('Попытка не найдена');
    const originalTest = await this.testRepo.findOne({ where: { id: attempt.testId } });
    if (!originalTest || originalTest.companyId !== companyId) throw new NotFoundException('Попытка не найдена');
    attempt.test = originalTest;
    if (attempt.status !== AttestationAttemptStatus.GRADED || attempt.passed) {
      throw new BadRequestException('Пересдача назначается только не сдавшим проверенную попытку');
    }
    const originalQuestions = await this.questionRepo.find({ where: { testId: attempt.testId } });
    const cardIds = Array.from(new Set(originalQuestions.map((q) => q.cardId).filter(Boolean))) as string[];
    const cards = cardIds.length ? await this.cardRepo.find({ where: { id: In(cardIds) } }) : [];

    const test = await this.testRepo.save(this.testRepo.create({
      companyId,
      title: `${attempt.test.title} · пересдача`,
      status: AttestationTestStatus.GENERATING,
      passingScorePercent: attempt.test.passingScorePercent,
      formVariant: 'B',
      originalTestId: attempt.test.id,
      createdBy: userId,
    }));
    void this.generateQuestionsAsync(test.id, cards, false).catch((e) => {
      this.logger.warn(`Генерация пересдачи ${test.id} упала: ${(e as Error).message}`);
    });
    return test;
  }
}
