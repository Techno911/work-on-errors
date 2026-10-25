import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { Company } from '../companies/entities/company.entity';
import { Sprint } from '../sprints/entities/sprint.entity';
import { SprintStatus } from '../sprints/enums/sprint-status.enum';
import { Entry } from '../entries/entities/entry.entity';
import { EntryType } from '../entries/enums/entry-type.enum';
import { EntryStatus } from '../entries/enums/entry-status.enum';
import { DEFAULT_ERROR_TAG_COLOR, ErrorTag } from '../error-tags/entities/error-tag.entity';
import { Notification, NotificationType } from '../notifications/entities/notification.entity';
import { ReviewTemplate } from '../review-templates/entities/review-template.entity';
import { UserGamification } from '../gamification/entities/user-gamification.entity';
import { Achievement } from '../gamification/entities/achievement.entity';

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
    @InjectRepository(Sprint)
    private readonly sprintRepository: Repository<Sprint>,
    @InjectRepository(Entry)
    private readonly entryRepository: Repository<Entry>,
    @InjectRepository(ErrorTag)
    private readonly errorTagRepository: Repository<ErrorTag>,
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(ReviewTemplate)
    private readonly reviewTemplateRepository: Repository<ReviewTemplate>,
    @InjectRepository(UserGamification)
    private readonly userGamificationRepository: Repository<UserGamification>,
    @InjectRepository(Achievement)
    private readonly achievementRepository: Repository<Achievement>,
  ) {}

  async onModuleInit() {
    // Демо-данные и тестовые аккаунты — только для dev/staging. На проде сид никогда не
    // выполняется: раньше он на каждом рестарте перезаписывал пароль суперадмина захардкоженным
    // значением (админ уже мог сменить его вручную) и восстанавливал удалённые тестовые аккаунты.
    if (process.env.NODE_ENV === 'production') {
      this.logger.log('Seed skipped: NODE_ENV=production');
      return;
    }
    this.logger.log('Checking seed data...');

    // ─── Шаг 1: Company (upsert) ────────────────────────────────────────────
    let company = await this.companiesRepository.findOne({
      where: { name: 'Демо-Авто' },
    });
    if (!company) {
      this.logger.log('Creating company Демо-Авто...');
      company = await this.companiesRepository.save({
        name: 'Демо-Авто',
        callsPerWeek: 5,
        chatsPerWeek: 5,
        managerDeadlineDay: 'friday',
        reviewerDeadlineDay: 'friday',
        thresholdGood: 500,
        thresholdGreat: 1000,
        callsEnabled: true,
        chatsEnabled: true,
        minSelfReviewCorrectChars: 100,
        minSelfReviewImproveChars: 150,
        minSelfReviewSuggestionsChars: 0,
        minReviewChars: 150,
      });
    } else {
      // Ensure sensible defaults for existing company (fixes 0-value issue from old schema)
      const needsUpdate =
        !company.minSelfReviewCorrectChars ||
        !company.minSelfReviewImproveChars ||
        !company.minReviewChars;
      if (needsUpdate) {
        this.logger.log('Updating company Демо-Авто with sensible default settings...');
        await this.companiesRepository.update(company.id, {
          minSelfReviewCorrectChars: company.minSelfReviewCorrectChars || 100,
          minSelfReviewImproveChars: company.minSelfReviewImproveChars || 150,
          minReviewChars: company.minReviewChars || 150,
        });
        company = (await this.companiesRepository.findOne({ where: { name: 'Демо-Авто' } })) ?? company;
      }
    }

    // Премия РОПа (кейс клиента): включаем для dev-компании, чтобы reviewer сразу видел расчёт.
    // Идемпотентно: только если тиры ещё дефолтные и премия выключена.
    if (!company.ropBonus?.enabled) {
      this.logger.log('Enabling ropBonus (demo case) for Демо-Авто...');
      await this.companiesRepository.update(company.id, {
        ropBonus: {
          enabled: true,
          tiers: [
            { thresholdPct: 95, amount: 20000 },
            { thresholdPct: 80, amount: 16000 },
          ],
        },
      });
    }

    // ─── Шаг 2: Users (upsert — всегда обновляем пароли!) ───────────────────
    this.logger.log('Upserting seed users (passwords always updated)...');

    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'admin-' + Math.random().toString(36).slice(2, 14);
    const demoPassword = process.env.SEED_DEMO_PASSWORD || 'demo-' + Math.random().toString(36).slice(2, 14);
    const seedUsers = [
      {
        email: 'admin@example.invalid',
        password: adminPassword,
        fullName: 'Демо-администратор',
        role: UserRole.SUPERADMIN,
        companyId: null as string | null,
        color: null as string | null,
      },
      {
        email: 'owner@example.invalid',
        password: demoPassword,
        fullName: 'Демо-владелец',
        role: UserRole.OWNER,
        companyId: company.id,
        color: '#0EA5E9',
      },
      {
        email: 'reviewer@example.invalid',
        password: demoPassword,
        fullName: 'Демо-руководитель',
        role: UserRole.REVIEWER,
        companyId: company.id,
        color: '#F97316',
      },
      {
        email: 'manager1@example.invalid',
        password: demoPassword,
        fullName: 'Демо-менеджер 1',
        role: UserRole.MANAGER,
        companyId: company.id,
        color: '#FDA4AF',
      },
      {
        email: 'manager2@example.invalid',
        password: demoPassword,
        fullName: 'Демо-менеджер 2',
        role: UserRole.MANAGER,
        companyId: company.id,
        color: '#FDE68A',
      },
      {
        email: 'manager3@example.invalid',
        password: demoPassword,
        fullName: 'Демо-менеджер 3',
        role: UserRole.MANAGER,
        companyId: company.id,
        color: '#86EFAC',
      },
      {
        email: 'manager4@example.invalid',
        password: demoPassword,
        fullName: 'Демо-менеджер 4',
        role: UserRole.MANAGER,
        companyId: company.id,
        color: '#C4B5FD',
      },
    ];

    for (const u of seedUsers) {
      const existing = await this.usersRepository.findOne({
        where: { email: u.email },
        withDeleted: true,
      });
      const hashedPassword = await bcrypt.hash(u.password, 10);
      if (existing) {
        // Всегда обновляем пароль и isActive, чтобы не было проблем
        await this.usersRepository.update(existing.id, {
          password: hashedPassword,
          isActive: true,
          deletedAt: null as any,
          fullName: u.fullName,
          role: u.role,
          companyId: u.companyId,
          color: u.color,
        });
        this.logger.log(`Updated user: ${u.email}`);
      } else {
        await this.usersRepository.save({
          email: u.email,
          password: hashedPassword,
          fullName: u.fullName,
          role: u.role,
          companyId: u.companyId,
          color: u.color,
          isActive: true,
        });
        this.logger.log(`Created user: ${u.email}`);
      }
    }

    // Stage 2: Sprints, ErrorTags, Entries
    const sprintCount = await this.sprintRepository.count();
    if (sprintCount === 0) {
      const sprint = await this.sprintRepository.save(
      this.sprintRepository.create({
        companyId: company.id,
        startDate: '2026-03-02',
        endDate: '2026-03-08',
        label: '2–8 март 2026',
        status: SprintStatus.ACTIVE,
      }),
    );

    // Error tags
    const tagData = [
      { name: 'нет_конкретики', color: '#EF4444' },
      { name: 'спешит_со_скидкой', color: '#F59E0B' },
      { name: 'не_закрывает_сделку', color: DEFAULT_ERROR_TAG_COLOR },
      { name: 'не_здоровается', color: '#8B5CF6' },
      { name: 'не_представляется_полностью', color: '#EC4899' },
    ];
    const tags = await this.errorTagRepository.save(
      tagData.map(t => this.errorTagRepository.create({ ...t, companyId: company.id })),
    );

    const tagMap = Object.fromEntries(tags.map(t => [t.name, t]));

    // Менеджер — первый менеджер
    const yuri = await this.usersRepository.findOne({ where: { email: 'manager1@example.invalid' } });
    const elena = await this.usersRepository.findOne({ where: { email: 'reviewer@example.invalid' } });

    if (!yuri || !elena) {
      this.logger.error('Yuri or Elena not found, skipping entries seed');
      return;
    }

    // Entry 1 — полный звонок с ревью
    const entry1 = await this.entryRepository.save(
      this.entryRepository.create({
        sprintId: sprint.id,
        managerId: yuri.id,
        companyId: company.id,
        type: EntryType.CALL,
        entryNumber: 1,
        entryDate: '2026-03-03',
        source: 'fireflies',
        transcription: `Менеджер: Здравствуйте! Компания Демо-Авто, меня зовут Иван. Чем могу помочь?\n\nКлиент: Здравствуйте, я хотел бы узнать стоимость ТО для Kia Rio 2020 года.\n\nМенеджер: Да, конечно. ТО у нас стоит от 5000 рублей. Зависит от пробега и что нужно менять.\n\nКлиент: А какие работы входят?\n\nМенеджер: Ну, замена масла, фильтров... Стандартный набор.\n\nКлиент: Понятно. А можно подешевле?\n\nМенеджер: Ну, можем скидку 10% сделать, если запишетесь сегодня.\n\nКлиент: Я подумаю.\n\nМенеджер: Хорошо, звоните.`,
        selfReviewCorrect: 'Представился, назвал компанию\nБыстро дал информацию по цене',
        selfReviewImprove: 'Не задал уточняющих вопросов про пробег и историю обслуживания\nСлишком быстро предложил скидку — клиент ещё не возражал по цене\nНе закрыл на конкретное действие — «звоните» это не закрытие',
        selfReviewSuggestions: '',
        status: EntryStatus.REVIEWED,
        reviewText: `Менеджер, хорошо, что заметил проблему со скидкой!\n\nДобавлю:\n«Стандартный набор» — это не ответ. Клиент хочет конкретику: «В ТО входит замена масла, масляного и воздушного фильтра, проверка тормозной системы и ходовой части — всего 12 пунктов».\nКонкретика = доверие.\n\nСкидку предложил на 40-й секунде — это потеря маржи. Правило: скидка — последний инструмент, не первый. Сначала создаём ценность.\n\nЗакрытие: вместо «звоните» — «Давайте я запишу вас на удобное время. Среда или четверг лучше подходит?»`,
        reviewedAt: new Date('2026-03-05'),
        reviewerId: elena.id,
      }),
    );

    entry1.errorTags = [tagMap['нет_конкретики'], tagMap['спешит_со_скидкой'], tagMap['не_закрывает_сделку']];
    await this.entryRepository.save(entry1);

    // Entry 2 — звонок с ревью
    const entry2 = await this.entryRepository.save(
      this.entryRepository.create({
        sprintId: sprint.id,
        managerId: yuri.id,
        companyId: company.id,
        type: EntryType.CALL,
        entryNumber: 2,
        entryDate: '2026-03-03',
        source: 'fireflies',
        transcription: `Менеджер: Демо-Авто, Менеджер.\n\nКлиент: Добрый день. У меня Hyundai Creta, загорелся чек. Что делать?\n\nМенеджер: Надо на диагностику приехать. Стоит 1500.\n\nКлиент: А долго это?\n\nМенеджер: Минут 30.\n\nКлиент: А когда можно?`,
        selfReviewCorrect: 'Записал клиента на конкретное время\nНазвал стоимость и время',
        selfReviewImprove: 'Не поздоровался нормально — сухо «Демо-Авто, Менеджер»\nНе спросил имя клиента',
        selfReviewSuggestions: '',
        status: EntryStatus.REVIEWED,
        reviewText: `Верно подмечено про приветствие.\nФормула: «Добрый день! Компания Демо-Авто, Менеджер. Как могу обращаться?» — 3 секунды, но сразу другой уровень.\n\nХорошо, что закрыл на визит. Но не объяснил, ЧТО будет на диагностике. Клиенту важно понимать, за что он платит.`,
        reviewedAt: new Date('2026-03-05'),
        reviewerId: elena.id,
      }),
    );

    entry2.errorTags = [tagMap['не_здоровается'], tagMap['не_представляется_полностью']];
    await this.entryRepository.save(entry2);

    // Entry 3 — переписка, черновик
    await this.entryRepository.save(
      this.entryRepository.create({
        sprintId: sprint.id,
        managerId: yuri.id,
        companyId: company.id,
        type: EntryType.CHAT,
        entryNumber: 1,
        entryDate: '2026-03-04',
        source: 'instagram',
        status: EntryStatus.DRAFT,
      }),
    );

    // === Исторические спринты для аналитики ===
    const existingSprintCount = await this.sprintRepository.count({ where: { companyId: company.id } });
    if (existingSprintCount < 3) {
      // === Предыдущий завершённый спринт ===
      const prevSprint = await this.sprintRepository.save(
        this.sprintRepository.create({
          companyId: company.id,
          startDate: '2026-02-23',
          endDate: '2026-03-01',
          label: '23 фев – 1 мар 2026',
          status: SprintStatus.COMPLETED,
        }),
      );

      // === Ещё один спринт ===
      const olderSprint = await this.sprintRepository.save(
        this.sprintRepository.create({
          companyId: company.id,
          startDate: '2026-02-16',
          endDate: '2026-02-22',
          label: '16–22 фев 2026',
          status: SprintStatus.COMPLETED,
        }),
      );

      // Найди Данилу
      const danila = await this.usersRepository.findOne({ where: { email: 'manager2@example.invalid' } });

      // === Записи в prevSprint для Юрия (нет_конкретики уменьшается) ===
      const prevEntry1 = await this.entryRepository.save(
        this.entryRepository.create({
          sprintId: prevSprint.id,
          managerId: yuri.id,
          companyId: company.id,
          type: EntryType.CALL,
          entryNumber: 1,
          entryDate: '2026-02-24',
          source: 'fireflies',
          transcription: `Менеджер: Демо-Авто, Менеджер.\n\nКлиент: Здравствуйте, хочу узнать про замену ремня ГРМ на Honda Civic.\n\nМенеджер: Ремень ГРМ стоит примерно от 8000 рублей. Зависит от комплектации.\n\nКлиент: А можно точнее?\n\nМенеджер: Ну, нужно смотреть по машине. Приезжайте, посмотрим.\n\nКлиент: Хорошо, спасибо.`,
          selfReviewCorrect: 'Назвал примерную стоимость. Предложил приехать.',
          selfReviewImprove: 'Снова не поздоровался нормально. Не узнал год выпуска и пробег — без этого цена неточная. Клиент ушёл без записи.',
          selfReviewSuggestions: 'Нужно сразу спрашивать точные данные об автомобиле.',
          status: EntryStatus.REVIEWED,
          reviewText: `Менеджер, прогресс есть — назвал цену. Но «примерно от 8000» без уточняющих данных = ничего не сказал.\n\nАлгоритм для ремня ГРМ:\n1. Год и пробег\n2. Только ремень или комплект (ролики, помпа)?\n3. Конкретная цена = доверие\n\nИ «приезжайте посмотрим» — это не запись. Запись: «Вас записать на диагностику? Есть время в среду в 11:00 или в четверг в 15:00».`,
          reviewedAt: new Date('2026-02-27'),
        }),
      );
      prevEntry1.reviewerId = elena.id;
      prevEntry1.errorTags = [tagMap['нет_конкретики'], tagMap['не_закрывает_сделку']];
      await this.entryRepository.save(prevEntry1);

      const prevEntry2 = await this.entryRepository.save(
        this.entryRepository.create({
          sprintId: prevSprint.id,
          managerId: yuri.id,
          companyId: company.id,
          type: EntryType.CALL,
          entryNumber: 2,
          entryDate: '2026-02-25',
          source: 'fireflies',
          transcription: `Менеджер: Здравствуйте, Демо-Авто!\n\nКлиент: Добрый день. Сколько стоит шиномонтаж?\n\nМенеджер: Шиномонтаж — от 400 рублей за колесо. Это снять-поставить. Балансировка отдельно — 200 рублей.\n\nКлиент: А если 4 колеса?\n\nМенеджер: Тогда 2400 всего — монтаж и балансировка всех четырёх.\n\nКлиент: Хорошо, спасибо, я подумаю.\n\nМенеджер: Ждём вас!`,
          selfReviewCorrect: 'Поздоровался! Дал конкретные цены. Посчитал итог за 4 колеса.',
          selfReviewImprove: 'Клиент сказал «подумаю» — я не закрыл. Нужно было предложить записаться.',
          selfReviewSuggestions: 'При «подумаю» спрашивать: «Что именно хотите уточнить? Могу помочь принять решение».',
          status: EntryStatus.REVIEWED,
          reviewText: `Менеджер, отличное приветствие и конкретные цены — молодец!\n\nПо «подумаю»: это сигнал, что клиент не уверен. Варианты:\n— «Что именно вас смущает?»\n— «У нас сейчас свободные окошки на этой неделе, могу записать»\n— «Если запишетесь сегодня — гарантирую это время»\n\nКлиент не вернётся «подумать» — нужно закрывать здесь.`,
          reviewedAt: new Date('2026-02-27'),
        }),
      );
      prevEntry2.reviewerId = elena.id;
      prevEntry2.errorTags = [tagMap['не_закрывает_сделку']];
      await this.entryRepository.save(prevEntry2);

      // === Записи для Данилы в prevSprint ===
      if (danila) {
        const danilaEntry1 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: prevSprint.id,
            managerId: danila.id,
            companyId: company.id,
            type: EntryType.CALL,
            entryNumber: 1,
            entryDate: '2026-02-24',
            source: 'otrai',
            transcription: `Менеджер: Демо-Авто.\n\nКлиент: Здравствуйте, хочу сдать машину на техобслуживание.\n\nМенеджер: Когда можете приехать?\n\nКлиент: Ну, в пятницу наверное.\n\nМенеджер: Хорошо, записываю на пятницу. В какое время?\n\nКлиент: Часов в 10.\n\nМенеджер: Окей, записал.`,
            selfReviewCorrect: 'Записал клиента на конкретное время.',
            selfReviewImprove: 'Не поздоровался. Не представился. Не уточнил марку автомобиля и что именно нужно сделать в ТО.',
            selfReviewSuggestions: 'Стандартное приветствие в начале каждого звонка.',
            status: EntryStatus.REVIEWED,
            reviewText: `Менеджер, хорошо что записал — это главный результат.\n\nНо «Демо-Авто» как приветствие — это ресепшн, не менеджер продаж.\n\nФормула: «Добрый день! Компания Демо-Авто, Менеджер. Как могу помочь?»\n\nИ важно: не узнали марку, модель, пробег — как будем готовиться к ТО? Менеджер должен задавать эти вопросы при записи.`,
            reviewedAt: new Date('2026-02-27'),
          }),
        );
        danilaEntry1.reviewerId = elena.id;
        danilaEntry1.errorTags = [tagMap['не_здоровается'], tagMap['не_представляется_полностью'], tagMap['нет_конкретики']];
        await this.entryRepository.save(danilaEntry1);

        const danilaEntry2 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: prevSprint.id,
            managerId: danila.id,
            companyId: company.id,
            type: EntryType.CHAT,
            entryNumber: 1,
            entryDate: '2026-02-25',
            source: 'whatsapp',
            status: EntryStatus.REVIEWED,
            selfReviewCorrect: 'Ответил быстро. Дал цену.',
            selfReviewImprove: 'Переписка очень короткая — не узнал контекст. Не предложил записаться.',
            selfReviewSuggestions: '',
            reviewText: `Менеджер, скорость ответа — хорошо. Но в переписке та же проблема: нет закрытия на действие.\n\nВ чате это критично — клиент легко уходит к конкурентам. После цены всегда: «Хотите записаться? Пришлите марку авто и удобное время — забронирую для вас».`,
            reviewedAt: new Date('2026-02-27'),
          }),
        );
        danilaEntry2.reviewerId = elena.id;
        danilaEntry2.errorTags = [tagMap['не_закрывает_сделку']];
        await this.entryRepository.save(danilaEntry2);
      }

      // === Записи в olderSprint для Юрия (нет_конкретики было больше) ===
      const olderEntry1 = await this.entryRepository.save(
        this.entryRepository.create({
          sprintId: olderSprint.id,
          managerId: yuri.id,
          companyId: company.id,
          type: EntryType.CALL,
          entryNumber: 1,
          entryDate: '2026-02-17',
          source: 'fireflies',
          transcription: `Менеджер: Демо-Авто.\n\nКлиент: Сколько стоит покраска бампера?\n\nМенеджер: Зависит от повреждений. По-разному.\n\nКлиент: Ну примерно?\n\nМенеджер: От 3000 до 15000. Надо смотреть.\n\nКлиент: Ясно, спасибо.`,
          selfReviewCorrect: 'Дал диапазон цен.',
          selfReviewImprove: 'Не поздоровался, не представился. Ответы слишком расплывчатые. Клиент ушёл.',
          selfReviewSuggestions: '',
          status: EntryStatus.REVIEWED,
          reviewText: `Менеджер, диапазон 3000-15000 — это не ответ, это отпугивание.\n\nАлгоритм:\n1. Спросить размер повреждения (фото в WhatsApp)\n2. Назвать конкретную цену для типичного случая\n3. Предложить осмотр\n\nИ: «Зависит от повреждений» без уточняющих вопросов = потеря клиента.`,
          reviewedAt: new Date('2026-02-20'),
        }),
      );
      olderEntry1.reviewerId = elena.id;
      olderEntry1.errorTags = [tagMap['нет_конкретики'], tagMap['не_здоровается'], tagMap['не_представляется_полностью']];
      await this.entryRepository.save(olderEntry1);

      const olderEntry2 = await this.entryRepository.save(
        this.entryRepository.create({
          sprintId: olderSprint.id,
          managerId: yuri.id,
          companyId: company.id,
          type: EntryType.CALL,
          entryNumber: 2,
          entryDate: '2026-02-17',
          source: 'manual',
          transcription: `Менеджер: Алло, Демо-Авто?\n\nКлиент: Да, здравствуйте. Можно записаться на замену масла сегодня?\n\nМенеджер: Сегодня мест нет. Завтра?\n\nКлиент: Ну ладно, завтра в 12?\n\nМенеджер: Хорошо, записал.\n\nКлиент: Цена?\n\nМенеджер: Зависит от масла. Придёте — скажем.`,
          selfReviewCorrect: 'Записал на конкретное время.',
          selfReviewImprove: 'Цена «зависит от масла, придёте скажем» — клиент должен знать стоимость до приезда. Это рождает недоверие.',
          selfReviewSuggestions: 'Заранее уточнять марку масла и давать ценовую вилку.',
          status: EntryStatus.REVIEWED,
          reviewText: `«Придёте — скажем» — это ловушка. Клиент придёт и окажется, что цена выше ожидания. Стресс, конфликт, плохой отзыв.\n\nЧто делать: «Замена масла у нас от 1500 рублей — это работа. Масло отдельно: синтетика от 2500 за 4 литра, полусинтетика дешевле. Какое масло обычно заливаете?»`,
          reviewedAt: new Date('2026-02-20'),
        }),
      );
      olderEntry2.reviewerId = elena.id;
      olderEntry2.errorTags = [tagMap['нет_конкретики'], tagMap['спешит_со_скидкой']];
      await this.entryRepository.save(olderEntry2);

      // Менеджер в olderSprint
      if (danila) {
        const olderDanilaEntry = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: olderSprint.id,
            managerId: danila.id,
            companyId: company.id,
            type: EntryType.CALL,
            entryNumber: 1,
            entryDate: '2026-02-18',
            source: 'fireflies',
            transcription: `Менеджер: Демо-Авто!\n\nКлиент: Здравствуйте. У меня вопрос по ходовой части — стук при повороте.\n\nМенеджер: Это нужно на диагностику. 1500 рублей.\n\nКлиент: А что конкретно стучит?\n\nМенеджер: Разное бывает — ШРУС, рулевые тяги... Надо смотреть.\n\nКлиент: Когда можно?\n\nМенеджер: В любой день.`,
            selfReviewCorrect: 'Предложил диагностику.',
            selfReviewImprove: 'Не закрыл на конкретное время. «В любой день» — это не запись.',
            selfReviewSuggestions: 'Предлагать конкретные слоты.',
            status: EntryStatus.REVIEWED,
            reviewText: `Менеджер, хорошо что предложил диагностику.\n\n«В любой день» = клиент уйдёт «подумать» и не вернётся.\n\nФормула закрытия: «Есть время сегодня после 16:00 или завтра утром в 9:00 — что удобнее?»\n\nДайте выбор из двух вариантов — это работает лучше открытого вопроса.`,
            reviewedAt: new Date('2026-02-20'),
          }),
        );
        olderDanilaEntry.reviewerId = elena.id;
        olderDanilaEntry.errorTags = [tagMap['не_закрывает_сделку'], tagMap['нет_конкретики']];
        await this.entryRepository.save(olderDanilaEntry);
      }
    }

    // === Seed notifications for Elena (reviewer) ===
    const notifCount = await this.notificationRepository.count();
    if (notifCount < 3) {
      // Re-fetch Elena and Yuri with their IDs for notifications
      const elenaUser = await this.usersRepository.findOne({ where: { email: 'reviewer@example.invalid' } });
      const yuriUser = await this.usersRepository.findOne({ where: { email: 'manager1@example.invalid' } });

      if (elenaUser && yuriUser) {
        await this.notificationRepository.save([
          this.notificationRepository.create({
            userId: elenaUser.id,
            type: NotificationType.ENTRY_SUBMITTED,
            title: 'Новая запись на проверку',
            message: 'Демо-менеджер 1 отправил(а) запись #1 на проверку',
            isRead: false,
            relatedId: null,
          }),
          this.notificationRepository.create({
            userId: elenaUser.id,
            type: NotificationType.ENTRY_SUBMITTED,
            title: 'Новая запись на проверку',
            message: 'Демо-менеджер 1 отправил(а) запись #2 на проверку',
            isRead: true,
            relatedId: null,
          }),
          this.notificationRepository.create({
            userId: yuriUser.id,
            type: NotificationType.ENTRY_REVIEWED,
            title: 'Ваша запись проверена',
            message: 'Запись #1 получила ревью',
            isRead: false,
            relatedId: null,
          }),
        ]);
      }
    }

    // === Seed review templates for Демо-Авто ===
    const tplCount = await this.reviewTemplateRepository.count({ where: { companyId: company.id } });
    if (tplCount === 0) {
      const elenaUser = await this.usersRepository.findOne({ where: { email: 'reviewer@example.invalid' } });
      const authorId = elenaUser?.id ?? company.id;
      const authorName = elenaUser?.fullName ?? 'Администратор';

      await this.reviewTemplateRepository.save([
        this.reviewTemplateRepository.create({
          companyId: company.id,
          name: '🚫 Не принято — нет раппорта',
          content: 'Звонок не принят к зачёту.\n\nМенеджер не установил раппорт с клиентом в первые 30 секунд диалога. Без доверия клиент не раскрывается и не слышит предложение.\n\nЧто попробовать:\n• Начать с имени клиента и обращения по имени\n• Добавить 1–2 фразы малого разговора\n• Уточнить удобство времени для разговора\n\nВ следующем звонке обратите особое внимание на первые 30 секунд — именно они задают тон всей беседе.',
          version: 1,
          isActive: true,
          createdBy: authorId,
          createdByName: authorName,
        }),
        this.reviewTemplateRepository.create({
          companyId: company.id,
          name: '✅ Принято — хорошая работа',
          content: 'Звонок принят к зачёту. Отличная работа!\n\nМенеджер грамотно выявил потребности: задал 3+ открытых вопроса и дал клиенту выговориться. Презентация продукта была ориентирована на конкретную боль клиента.\n\nРекомендация на следующий звонок:\nПопробуйте завершить разговор конкретным следующим шагом с чёткой датой и временем — это повышает конверсию в сделку.',
          version: 1,
          isActive: true,
          createdBy: authorId,
          createdByName: authorName,
        }),
        this.reviewTemplateRepository.create({
          companyId: company.id,
          name: '💡 Работа с возражениями',
          content: 'Звонок принят к зачёту.\n\nМомент для роста: при возражении «дорого» менеджер сразу предложил скидку. Это снижает воспринимаемую ценность продукта и задаёт неверный прецедент.\n\nЧто попробовать:\n• Сначала выяснить, с чем клиент сравнивает цену\n• Обосновать ценность через конкретный результат, который получит клиент\n• Скидку использовать только как последний инструмент, не первый',
          version: 1,
          isActive: true,
          createdBy: authorId,
          createdByName: authorName,
        }),
        this.reviewTemplateRepository.create({
          companyId: company.id,
          name: '📞 Хаотичная структура звонка',
          content: 'Звонок не принят к зачёту.\n\nСтруктура разговора была нарушена: менеджер перешёл к презентации продукта, не выявив потребности клиента. В результате клиент не увидел связи между предложением и своей задачей.\n\nРабочая структура: приветствие → выявление потребности → презентация под потребность → работа с возражениями → закрытие на следующий шаг.\n\nПовторите звонок с соблюдением этой структуры.',
          version: 1,
          isActive: true,
          createdBy: authorId,
          createdByName: authorName,
        }),
      ]);
      this.logger.log('Review templates created for Демо-Авто');
    }
    } // end if (sprintCount === 0)

    // ─── Stage 3: Ensure 6th error tag exists ───────────────────────────────
    const company2 = await this.companiesRepository.findOne({ where: { name: 'Демо-Авто' } });
    if (!company2) {
      this.logger.log('Seed data created successfully!');
      return;
    }

    const existingIgnoreTag = await this.errorTagRepository.findOne({ where: { name: 'не_слышит_клиента', companyId: company2.id } });
    if (!existingIgnoreTag) {
      await this.errorTagRepository.save(
        this.errorTagRepository.create({ name: 'не_слышит_клиента', color: '#6366F1', companyId: company2.id }),
      );
    }

    // ─── Stage 4: Kristina entries in active sprint ──────────────────────────
    const kristina = await this.usersRepository.findOne({ where: { email: 'manager3@example.invalid' } });
    const elena2 = await this.usersRepository.findOne({ where: { email: 'reviewer@example.invalid' } });
    const activeSprint = await this.sprintRepository.findOne({ where: { companyId: company2.id, status: SprintStatus.ACTIVE } });

    const allTags = await this.errorTagRepository.find({ where: { companyId: company2.id } });
    const tMap = Object.fromEntries(allTags.map(t => [t.name, t]));

    if (kristina && elena2 && activeSprint) {
      const kristinaEntryCount = await this.entryRepository.count({ where: { managerId: kristina.id, sprintId: activeSprint.id } });
      if (kristinaEntryCount === 0) {
        // Entry 1: CALL, reviewed — спешит_со_скидкой
        const kEntry1 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: kristina.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 1,
            entryDate: '2026-03-03',
            source: 'fireflies',
            selfReviewCorrect: 'Поздоровалась, представилась\nВыяснила что нужно клиенту',
            selfReviewImprove: 'Слишком быстро предложила скидку — клиент ещё не возражал по цене\nНе уточнила объём работ',
            selfReviewSuggestions: '',
            status: EntryStatus.REVIEWED,
            reviewText: 'Коллега, хорошее приветствие! Клиент оценивает ваш профессионализм с первых секунд.\n\nПо скидке: правило «скидка — последний инструмент». Сначала создайте ценность, потом — если нужно — уступка. Вы отдали маржу раньше, чем клиент попросил.\n\nНа будущее: «Стоимость зависит от объёма работ. Давайте я уточню: это летние или зимние? Диски 14 или 15?» — это профессионализм, а не торговля.',
            reviewedAt: new Date('2026-03-04'),
            reviewerId: elena2.id,
          }),
        );
        kEntry1.errorTags = tMap['спешит_со_скидкой'] ? [tMap['спешит_со_скидкой']] : [];
        await this.entryRepository.save(kEntry1);

        // Entry 2: CALL, reviewed — no errors
        const kEntry2 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: kristina.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 2,
            entryDate: '2026-03-03',
            source: 'fireflies',
            selfReviewCorrect: 'Уточнила марку масла и год выпуска\nЗаписала на конкретное время\nНазвала полную стоимость',
            selfReviewImprove: 'Могла бы предложить проверить фильтры заодно',
            selfReviewSuggestions: '',
            status: EntryStatus.REVIEWED,
            reviewText: 'Коллега, отличный звонок! Это именно то, как должен выглядеть профессиональный менеджер:\n✓ Уточнили детали (год, масло)\n✓ Назвали конкретную цену\n✓ Записали на время\n\nКак допродажа: «Пока будем менять масло, хотите заодно проверим воздушный фильтр? Часто меняют вместе — сэкономите на следующем визите».\n\nПродолжайте в том же духе!',
            reviewedAt: new Date('2026-03-05'),
            reviewerId: elena2.id,
          }),
        );
        kEntry2.errorTags = [];
        await this.entryRepository.save(kEntry2);

        // Entry 3: CALL, reviewed — не_закрывает_сделку
        const kEntry3 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: kristina.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 3,
            entryDate: '2026-03-04',
            source: 'fireflies',
            selfReviewCorrect: 'Уточнила размер повреждения\nНазвала конкретную цену за работу',
            selfReviewImprove: 'Клиент сказал «подумаю» — не предложила записаться\nНе попросила прислать фото',
            selfReviewSuggestions: '',
            status: EntryStatus.REVIEWED,
            reviewText: 'Коллега, хорошая конкретика по цене — клиент чувствует себя в безопасности.\n\nНо «подумаю» — это сигнал о сомнении. Три варианта ответа:\n1. «Что именно хотите обдумать? Может, есть вопросы?»\n2. «У нас сейчас свободные окошки на этой неделе»\n3. «Пришлите фото повреждения в WhatsApp — дам точную цену»\n\nТретий вариант особенно работает — клиент делает микродействие и вовлекается.',
            reviewedAt: new Date('2026-03-06'),
            reviewerId: elena2.id,
          }),
        );
        kEntry3.errorTags = tMap['не_закрывает_сделку'] ? [tMap['не_закрывает_сделку']] : [];
        await this.entryRepository.save(kEntry3);

        // Entry 4: CHAT, reviewed — нет_конкретики, не_закрывает_сделку
        const kEntry4 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: kristina.id,
            companyId: company2.id,
            type: EntryType.CHAT,
            entryNumber: 1,
            entryDate: '2026-03-04',
            source: 'instagram',
            selfReviewCorrect: 'Ответила быстро\nПредложила приехать на диагностику',
            selfReviewImprove: 'В переписке не спросила марку и год автомобиля\nНе предложила конкретное время',
            selfReviewSuggestions: '',
            status: EntryStatus.REVIEWED,
            reviewText: 'Коллега, скорость — хорошо, это важно в переписке.\n\nНо без марки авто невозможно дать точную цену — это отталкивает клиентов (они ждут конкретики).\n\nФормула для чата:\n«Марка и год авто?» → получаем → называем цену → «Запишем на среду в 11 или четверг в 14?»\n\nТри сообщения — запись в кармане.',
            reviewedAt: new Date('2026-03-06'),
            reviewerId: elena2.id,
          }),
        );
        kEntry4.errorTags = [tMap['нет_конкретики'], tMap['не_закрывает_сделку']].filter(Boolean);
        await this.entryRepository.save(kEntry4);
      }
    }

    // ─── Stage 5: Danila entries in active sprint ────────────────────────────
    const danila2 = await this.usersRepository.findOne({ where: { email: 'manager2@example.invalid' } });
    if (danila2 && elena2 && activeSprint) {
      const danilaCurrentCount = await this.entryRepository.count({ where: { managerId: danila2.id, sprintId: activeSprint.id } });
      if (danilaCurrentCount === 0) {
        // Entry 1: CALL, reviewed — no errors
        const dEntry1 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: danila2.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 1,
            entryDate: '2026-03-03',
            source: 'otrai',
            selfReviewCorrect: 'Поздоровался нормально\nЗаписал на конкретное время',
            selfReviewImprove: 'Не предложил дополнительные услуги при записи на ТО',
            selfReviewSuggestions: '',
            status: EntryStatus.REVIEWED,
            reviewText: 'Менеджер, прогресс! Теперь вы здороваетесь профессионально — это фундамент.\n\nПо допродаже: при записи на ТО это самый легкий момент: «Пока будем делать ТО, хотите проверим состояние тормозных колодок? По статистике каждый третий автомобиль с вашим пробегом требует замены» — это не навязывание, это забота о клиенте.',
            reviewedAt: new Date('2026-03-05'),
            reviewerId: elena2.id,
          }),
        );
        dEntry1.errorTags = [];
        await this.entryRepository.save(dEntry1);

        // Entry 2: CALL, reviewed — не_закрывает_сделку
        const dEntry2 = await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: danila2.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 2,
            entryDate: '2026-03-04',
            source: 'fireflies',
            selfReviewCorrect: 'Дал информацию о стоимости диагностики\nОбъяснил что будет входить в диагностику',
            selfReviewImprove: 'Снова не закрыл на конкретное время — сказал «звоните»',
            selfReviewSuggestions: '',
            status: EntryStatus.REVIEWED,
            reviewText: 'Менеджер, хорошая детализация по диагностике — клиент теперь знает за что платит.\n\nНо «звоните» — это антипаттерн. Правило: никогда не заканчивай звонок без конкретного следующего шага.\n\nЗамените на: «Давайте я запишу вас прямо сейчас. Завтра в 10 или послезавтра в 14 — что удобнее?»\n\nДайте выбор из 2 вариантов — это снижает барьер принятия решения.',
            reviewedAt: new Date('2026-03-05'),
            reviewerId: elena2.id,
          }),
        );
        dEntry2.errorTags = tMap['не_закрывает_сделку'] ? [tMap['не_закрывает_сделку']] : [];
        await this.entryRepository.save(dEntry2);

        // Entry 3: CALL, DRAFT — no selfReview
        await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: danila2.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 3,
            entryDate: '2026-03-05',
            source: 'manual',
            status: EntryStatus.DRAFT,
          }),
        );

        // Entry 4: CALL, SUBMITTED
        await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: danila2.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 4,
            entryDate: '2026-03-05',
            source: 'fireflies',
            selfReviewCorrect: 'Поздоровался, представился полностью\nЗадал уточняющие вопросы о пробеге',
            selfReviewImprove: 'Не закрыл на запись — клиент ушёл думать',
            selfReviewSuggestions: '',
            status: EntryStatus.SUBMITTED,
          }),
        );

        // Entry 5: CHAT, SUBMITTED
        await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: danila2.id,
            companyId: company2.id,
            type: EntryType.CHAT,
            entryNumber: 1,
            entryDate: '2026-03-06',
            source: 'whatsapp',
            selfReviewCorrect: 'Ответил быстро\nДал точную цену по марке авто',
            selfReviewImprove: 'Не предложил конкретное время для записи',
            selfReviewSuggestions: '',
            status: EntryStatus.SUBMITTED,
          }),
        );
      }
    }

    // ─── Stage 6: Lubov entries in active sprint ─────────────────────────────
    const lubov2 = await this.usersRepository.findOne({ where: { email: 'manager4@example.invalid' } });
    if (lubov2 && activeSprint) {
      const lubovCount = await this.entryRepository.count({ where: { managerId: lubov2.id, sprintId: activeSprint.id } });
      if (lubovCount === 0) {
        // Entry 1: CALL, SUBMITTED
        await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: lubov2.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 1,
            entryDate: '2026-03-04',
            source: 'fireflies',
            selfReviewCorrect: 'Поздоровалась и представилась\nВыяснила потребность клиента',
            selfReviewImprove: 'Предложила скидку при первом же вопросе о цене\nНе уточнила конкретный вид работ',
            selfReviewSuggestions: '',
            status: EntryStatus.SUBMITTED,
          }),
        );

        // Entry 2: CALL, DRAFT
        await this.entryRepository.save(
          this.entryRepository.create({
            sprintId: activeSprint.id,
            managerId: lubov2.id,
            companyId: company2.id,
            type: EntryType.CALL,
            entryNumber: 2,
            entryDate: '2026-03-05',
            source: 'otrai',
            status: EntryStatus.DRAFT,
          }),
        );
      }
    }

    // ─── Stage 7: Gamification data ──────────────────────────────────────────
    const yuriGam = await this.usersRepository.findOne({ where: { email: 'manager1@example.invalid' } });
    const danilaGam = await this.usersRepository.findOne({ where: { email: 'manager2@example.invalid' } });
    const kristinaGam = await this.usersRepository.findOne({ where: { email: 'manager3@example.invalid' } });
    const lubovGam = await this.usersRepository.findOne({ where: { email: 'manager4@example.invalid' } });

    const managers = [yuriGam, danilaGam, kristinaGam, lubovGam].filter(Boolean) as User[];
    for (const manager of managers) {
      const existing = await this.userGamificationRepository.findOne({ where: { userId: manager.id } });
      if (!existing) {
        const xpMap: Record<string, number> = {
          'manager1@example.invalid': 340,
          'manager3@example.invalid': 285,
          'manager2@example.invalid': 210,
          'manager4@example.invalid': 85,
        };
        const streakMap: Record<string, number> = {
          'manager1@example.invalid': 3,
          'manager3@example.invalid': 2,
          'manager2@example.invalid': 1,
          'manager4@example.invalid': 0,
        };
        await this.userGamificationRepository.save(
          this.userGamificationRepository.create({
            userId: manager.id,
            totalXp: xpMap[manager.email] ?? 0,
            currentStreak: streakMap[manager.email] ?? 0,
            bestStreak: Math.max((streakMap[manager.email] ?? 0) + 1, 7), // инвариант: у выданной ачивки «7 недель» рекорд не ниже порога
            lastStreakWeek: '2026-03-02',
            consecutiveNoErrorReviews: 0,
            consecutiveFullSelfReviews: 0,
            consecutiveGreatWeeks: 0,
          }),
        );
      }
    }

    // Achievements for Yuri
    if (yuriGam) {
      const yuriAchievements = await this.achievementRepository.count({ where: { userId: yuriGam.id } });
      if (yuriAchievements === 0) {
        await this.achievementRepository.save([
          this.achievementRepository.create({ userId: yuriGam.id, type: 'first_submit' as any, earnedAt: new Date('2026-02-17') }),
          this.achievementRepository.create({ userId: yuriGam.id, type: 'streak_7' as any, earnedAt: new Date('2026-02-24') }),
        ]);
      }
    }

    // Achievements for Kristina
    if (kristinaGam) {
      const kristinaAchievements = await this.achievementRepository.count({ where: { userId: kristinaGam.id } });
      if (kristinaAchievements === 0) {
        await this.achievementRepository.save([
          this.achievementRepository.create({ userId: kristinaGam.id, type: 'first_submit' as any, earnedAt: new Date('2026-02-17') }),
          this.achievementRepository.create({ userId: kristinaGam.id, type: 'sniper' as any, earnedAt: new Date('2026-03-05') }),
        ]);
      }
    }

    this.logger.log('Seed data created successfully!');
    this.logger.log('Test accounts (dev only, passwords in seedUsers above): ' +
      seedUsers.map((u) => u.email).join(', '));
  }
}
