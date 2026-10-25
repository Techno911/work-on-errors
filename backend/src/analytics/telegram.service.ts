import { Injectable, Logger, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { randomBytes } from 'crypto';
import { TelegramContact } from './entities/telegram-contact.entity';
import { TelegramDetectedChat } from './entities/telegram-detected-chat.entity';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 минут — хватает открыть Telegram и нажать Start

// Приветствие в рабочий чат при привязке. Человеческое: команда клиента видит его и без контекста
// должна понять, что это за бот и зачем он здесь (голое «Готово, подключена» пугало). Без коммерции.
const WORK_CHAT_WELCOME =
  'Здравствуйте! Это бот платформы «Работа над ошибками» от «ЧиП». ' +
  'Он подключён к этому чату, чтобы отмечать активность команды для разборов звонков и переписок. ' +
  'Делать ничего не нужно, работайте как обычно.';

/**
 * Лёгкий клиент Telegram Bot API: отправка уведомлений + единый поллер апдейтов.
 * Берёт TELEGRAM_BOT_TOKEN из env. Пустой токен → молча ничего не делаем (dev).
 *
 * ВАЖНО про getUpdates: единственный потребитель — pollUpdates() с курсором offset.
 * Остальные методы (refreshContacts, resolveChatId) дёргают его же, иначе апдейты
 * «крадут» друг у друга (offset подтверждает и удаляет их на стороне Telegram).
 *
 * Что делает поллер:
 *  - приватный чат: карта @username → chat_id + привязка userId из deep-link «/start <hex>»;
 *  - групповой чат: «/bind <code>» привязывает чат к компании; первая активность в
 *    привязанном чате фиксирует workStartedAt (Bot API не видит историю до добавления бота).
 */
@Injectable()
export class TelegramService implements OnModuleInit {
  private readonly logger = new Logger(TelegramService.name);
  private cachedBotUsername: string | null = null;
  private cachedBotId: number | null = null;
  // Курсор апдейтов. Хранится в памяти: после рестарта Telegram отдаёт только
  // неподтверждённые апдейты (уже обработанные с advance offset удалены), а обработчики
  // идемпотентны (upsert контакта, workStartedAt ставится только если пуст).
  private lastUpdateId = 0;
  /** Сколько опросов подряд не прошли: одиночный сбой это шум, серия это поломка канала. */
  private pollFailStreak = 0;

  constructor(
    @InjectRepository(TelegramContact)
    private readonly contactRepo: Repository<TelegramContact>,
    @InjectRepository(TelegramDetectedChat)
    private readonly detectedRepo: Repository<TelegramDetectedChat>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  private get botToken(): string {
    return process.env.TELEGRAM_BOT_TOKEN ?? '';
  }

  get enabled(): boolean {
    return this.botToken.length > 0;
  }

  /**
   * Бутстрап детекта при старте приложения: сразу грузим identity бота (getMe) и делаем первый
   * опрос апдейтов, не дожидаясь 2-минутного крона. Важно после деплоя/рестарта — иначе детект
   * рабочего чата «спит» до первого крон-тика, и «Проверить» сразу после добавления бота молчит.
   */
  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.loadMe();
      await this.pollUpdates();
    } catch (err) {
      this.logger.warn(`TG bootstrap error: ${(err as Error).message}`);
    }
  }

  /** Username бота для deep-link (t.me/<bot>?start=...). Кэшируется после первого getMe. */
  async getBotUsername(): Promise<string | null> {
    if (!this.enabled) return null;
    if (this.cachedBotUsername) return this.cachedBotUsername;
    await this.loadMe();
    return this.cachedBotUsername;
  }

  /** getMe: кэширует username И id бота (id нужен для getChatMember при пробе админ-статуса). */
  private async loadMe(): Promise<void> {
    if (!this.enabled) return;
    if (this.cachedBotId && this.cachedBotUsername) return;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.botToken}/getMe`);
      if (!res.ok) return;
      const data = (await res.json()) as { result?: { id?: number; username?: string } };
      this.cachedBotUsername = data.result?.username ?? this.cachedBotUsername;
      this.cachedBotId = data.result?.id ?? this.cachedBotId;
    } catch (err) {
      this.logger.warn(`TG getMe error: ${(err as Error).message}`);
    }
  }

  /**
   * Жив ли чат: бот всё ещё может в него писать (getChat отвечает 200).
   *
   * Проверка построена на «получен ЛЮБОЙ ответ от API» → дальше смотрим ok, а не на факте
   * успешной отправки: спрашивать живость канала, отправляя человеку сообщение, нельзя.
   * Сетевой сбой считаем «живым» (fail-open): иначе минутный сбой сети превратится в
   * тревогу «клиент удалил бота», и на такие тревоги перестанут смотреть.
   */
  async isChatAlive(chatId: string): Promise<boolean> {
    if (!this.enabled) return true;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getChat?chat_id=${encodeURIComponent(chatId)}`,
      );
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (data && typeof data.ok === 'boolean') return data.ok;
      return res.ok;
    } catch (err) {
      this.logger.debug(`TG getChat network error for ${chatId}: ${(err as Error).message}`);
      return true;
    }
  }

  /** Админ ли наш бот в чате (getChatMember по своему id). Для точной метки в списке чатов. */
  private async isBotAdminInChat(chatId: string): Promise<boolean> {
    if (!this.enabled) return false;
    await this.loadMe();
    if (!this.cachedBotId) return false;
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${this.cachedBotId}`,
      );
      if (!res.ok) return false;
      const data = (await res.json()) as { result?: { status?: string } };
      const status = data.result?.status;
      return status === 'administrator' || status === 'creator';
    } catch {
      return false;
    }
  }

  /**
   * Апсерт обнаруженного чата в реестр (единый путь для my_chat_member и для сообщений в чате).
   * isAdmin опционален: при детекте по сообщению мы не делаем сетевой getChatMember в критическом
   * пути (сохраняем прежнее значение), а уточняем флаг отдельно через refreshChatAdminFlag.
   */
  private async upsertDetectedChat(chatId: string, title: string | null, isAdmin?: boolean): Promise<void> {
    const existing = await this.detectedRepo.findOne({ where: { chatId } });
    await this.detectedRepo.save({
      chatId,
      title: title ?? existing?.title ?? null,
      isAdmin: isAdmin ?? existing?.isAdmin ?? false,
      boundCompanyId: existing?.boundCompanyId ?? null,
    });
  }

  /** Best-effort уточнение админ-статуса бота в чате — вне критического пути детекта (сеть). */
  private async refreshChatAdminFlag(chatId: string): Promise<void> {
    try {
      if (await this.isBotAdminInChat(chatId)) {
        await this.upsertDetectedChat(chatId, null, true);
      }
    } catch {
      /* некритично: метка админ-статуса обновится при следующем событии */
    }
  }

  /** Контакт, привязанный к пользователю платформы через deep-link. */
  async findContactByUserId(userId: string): Promise<TelegramContact | null> {
    return this.contactRepo.findOne({ where: { userId } });
  }

  /**
   * Чаты НАШЕЙ стороны для внутренних сигналов (свод здоровья, тишина после запуска,
   * отказ распознавания, доступ без входа).
   *
   * Раньше адрес был один: переменная окружения SUPERADMIN_TG_CHAT_ID. На проде она оказалась
   * не задана вообще (проверено 05.08.2026 в контейнере), поэтому ВСЕ внутренние сигналы
   * молча уходили в никуда: свод здоровья не отправлялся ни разу, и это было неотличимо от
   * «всё хорошо». Один носитель адреса, который никто не проверяет, и есть механизм дрейфа.
   *
   * Теперь адресаты собираются из двух источников: переменная окружения (если задана) плюс
   * личные привязки всех активных суперадминов и трекеров. Тогда достаточно, чтобы хоть один
   * из наших подключил бота кнопкой в платформе, и канал живой.
   */
  async staffChatIds(): Promise<string[]> {
    const chats = new Set<string>();
    const envChat = (process.env.SUPERADMIN_TG_CHAT_ID ?? '').trim();
    if (envChat) chats.add(envChat);
    const staff = await this.userRepo.find({
      where: [
        { role: UserRole.SUPERADMIN, isActive: true },
        { role: UserRole.TRACKER, isActive: true },
      ],
    });
    for (const s of staff) {
      const contact = await this.contactRepo.findOne({ where: { userId: s.id } });
      if (contact?.chatId) chats.add(contact.chatId);
    }
    return [...chats];
  }

  /** Публичное обновление карты контактов (кнопка «Проверить подключение»). */
  async refreshContacts(): Promise<void> {
    await this.pollUpdates();
  }

  /**
   * Одноразовый TTL-токен для deep-link «/start <token>» этого пользователя (TG2).
   * Переиспользует ещё не истёкший токен (повторные открытия страницы настроек не плодят токены).
   */
  async issueLinkToken(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new Error('Пользователь не найден');
    const now = Date.now();
    if (user.telegramLinkToken && user.telegramLinkTokenExpiresAt && user.telegramLinkTokenExpiresAt.getTime() > now) {
      return user.telegramLinkToken;
    }
    const token = randomBytes(16).toString('hex'); // 32 hex-символа — формат совпадает со старым payload
    user.telegramLinkToken = token;
    user.telegramLinkTokenExpiresAt = new Date(now + LINK_TOKEN_TTL_MS);
    await this.userRepo.save(user);
    return token;
  }

  /** chat_id возвращаем как есть; @username резолвим через карту контактов + один опрос апдейтов. */
  async resolveChatId(recipient: string): Promise<string | null> {
    const r = recipient.trim();
    if (!r) return null;
    if (!r.startsWith('@')) return r;
    const username = r.slice(1).toLowerCase();
    const known = await this.contactRepo.findOne({ where: { username } });
    if (known) return known.chatId;
    await this.pollUpdates();
    const found = await this.contactRepo.findOne({ where: { username } });
    if (!found) {
      this.logger.warn(`TG: @${username} не найден — получатель должен написать боту /start`);
    }
    return found?.chatId ?? null;
  }

  // ── Поллер апдейтов ────────────────────────────────────────────────────────

  /** Периодический опрос: раз в 2 минуты забираем новые апдейты и обрабатываем. */
  @Cron('*/2 * * * *')
  async scheduledPoll(): Promise<void> {
    try {
      await this.pollUpdates();
    } catch (err) {
      this.logger.warn(`TG poll error: ${(err as Error).message}`);
    }
  }

  /** Единственный потребитель getUpdates. Идемпотентные обработчики, курсор offset. */
  async pollUpdates(): Promise<void> {
    if (!this.enabled) return;
    try {
      const offset = this.lastUpdateId > 0 ? `&offset=${this.lastUpdateId + 1}` : '';
      const allowed = encodeURIComponent(JSON.stringify(['message', 'my_chat_member']));
      const res = await fetch(
        `https://api.telegram.org/bot${this.botToken}/getUpdates?limit=100&timeout=0&allowed_updates=${allowed}${offset}`,
      );
      if (!res.ok) return;
      const data = (await res.json()) as { result?: TgUpdate[] };
      for (const u of data.result ?? []) {
        try {
          await this.handleUpdate(u);
        } catch (err) {
          // НЕ продвигаем offset: несработавший апдейт вернётся на следующем опросе (обработчики
          // идемпотентны). Раньше offset двигался ДО обработки — транзиентный сбой (getChatMember)
          // терял апдейт про добавление бота навсегда, и рабочий чат оставался невидимым.
          this.logger.warn(`TG update handle error, will retry: ${(err as Error).message}`);
          break;
        }
        if (typeof u.update_id === 'number' && u.update_id > this.lastUpdateId) {
          this.lastUpdateId = u.update_id;
        }
      }
    } catch (err) {
      // Сетевой сбой опроса не теряет апдейты: offset не двинулся, их заберёт следующий заход
      // через две минуты. На проде это около 7% попыток (166 за 72 часа), и на уровне WARN
      // такой шум маскировал настоящие отказы в том же логе. Подряд идущие сбои это уже
      // не шум, а поломка канала, поэтому серия остаётся видимой.
      this.pollFailStreak++;
      const msg = `TG getUpdates error: ${(err as Error).message}`;
      if (this.pollFailStreak >= 5) {
        this.logger.warn(`${msg} (подряд: ${this.pollFailStreak})`);
      } else {
        this.logger.debug(msg);
      }
      return;
    }
    this.pollFailStreak = 0;
  }

  private async handleUpdate(u: TgUpdate): Promise<void> {
    // Бота добавили/сделали админом/убрали в группе — это приходит ВСЕГДА (событие про самого бота,
    // не зависит от privacy-mode). Так надёжно обнаруживаем рабочий чат без команды в чате клиента.
    if (u.my_chat_member) {
      await this.handleMyChatMember(u.my_chat_member);
      return;
    }

    const msg = u.message;
    if (!msg?.chat?.id) return;
    const chatType = msg.chat.type;
    const chatId = String(msg.chat.id);
    // Unix-секунды → Date (реальное время события в чате).
    const eventAt = msg.date ? new Date(msg.date * 1000) : new Date();

    if (chatType === 'private') {
      await this.linkPrivateContact(msg, chatId);
      return;
    }

    if (chatType === 'group' || chatType === 'supergroup') {
      // Бесшовное добавление: кнопка «Добавить бота в чат» ведёт на t.me/<bot>?startgroup=<code>,
      // после выбора группы Telegram шлёт боту «/start <code>» — привязываем чат к компании сразу,
      // как и «/bind <code>». Оба варианта команды ищем в любом месте сообщения.
      const bind = /\/(?:bind|start)(?:@\w+)?\s+([A-Za-z0-9]{4,64})(?![A-Za-z0-9])/.exec(msg.text ?? '');
      if (bind) {
        await this.bindWorkChat(bind[1], chatId);
        return;
      }
      // Привязанный чат: активность фиксирует старт работы. НЕпривязанный: регистрируем чат
      // как обнаруженный. Это лечит слепоту детекта — `my_chat_member` приходит ТОЛЬКО в момент
      // добавления/повышения бота, поэтому бот, добавленный в чаты до старта поллера, был невидим;
      // а сообщение бот-админ видит всегда, и по нему чат надёжно попадает в реестр для привязки.
      const bound = await this.companyRepo.findOne({ where: { telegramWorkChatId: chatId } });
      if (bound) {
        await this.markWorkStartFromChat(chatId, eventAt);
      } else {
        // Апсертим чат СРАЗУ (только БД) — без сетевого getChatMember в критическом пути детекта:
        // его транзиентный сбой раньше ронял обработку апдейта, и чат не попадал в реестр.
        // Админ-статус уточняем best-effort отдельно (для метки в списке, не критично).
        await this.upsertDetectedChat(chatId, msg.chat?.title ?? null);
        void this.refreshChatAdminFlag(chatId);
      }
    }
  }

  /** Приватный контакт: карта @username → chat_id + userId по одноразовому TTL-токену из deep-link. */
  private async linkPrivateContact(msg: TgMessage, chatId: string): Promise<void> {
    const username = msg.from?.username?.toLowerCase() ?? `id:${chatId}`;
    const startMatch = /^\/start\s+([0-9a-f]{32})\s*$/i.exec(msg.text ?? '');
    let userId: string | undefined;
    if (startMatch) {
      const token = startMatch[1].toLowerCase();
      const owner = await this.userRepo.findOne({ where: { telegramLinkToken: token } });
      if (owner?.telegramLinkTokenExpiresAt && owner.telegramLinkTokenExpiresAt.getTime() > Date.now()) {
        userId = owner.id;
        // Одноразовый: гасим сразу, чтобы токен нельзя было переиспользовать/подсмотреть позже.
        owner.telegramLinkToken = null;
        owner.telegramLinkTokenExpiresAt = null;
        await this.userRepo.save(owner);
      } else {
        this.logger.warn('TG: /start с неизвестным или истёкшим токеном привязки');
      }
    }
    const existing = await this.contactRepo.findOne({ where: { username } });
    await this.contactRepo.save({
      username,
      chatId,
      userId: userId ?? existing?.userId ?? null,
    });
  }

  /** Бот добавлен/повышен/убран в группе: обновляем реестр обнаруженных чатов. */
  private async handleMyChatMember(m: TgMyChatMember): Promise<void> {
    const chat = m.chat;
    if (!chat?.id || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    const chatId = String(chat.id);
    const status = m.new_chat_member?.status;
    if (status === 'left' || status === 'kicked') {
      await this.detectedRepo.delete({ chatId });
      this.logger.log(`TG: bot removed from chat ${chatId}`);
      return;
    }
    const isAdmin = status === 'administrator' || status === 'creator';
    await this.upsertDetectedChat(chatId, chat.title ?? null, isAdmin);
    this.logger.log(`TG: detected chat ${chatId} admin=${isAdmin}`);
  }

  /** Обнаруженные, но ещё не привязанные чаты (для выбора трекером в платформе). */
  async listUnboundChats(): Promise<TelegramDetectedChat[]> {
    return this.detectedRepo.find({ where: { boundCompanyId: IsNull() }, order: { updatedAt: 'DESC' } });
  }

  /** Привязать обнаруженный чат к компании (по кнопке в платформе). */
  async bindDetectedChat(companyId: string, chatId: string): Promise<Company> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    // Обычный Error здесь раньше превращался в 500, хотя это ожидаемые ошибки валидации (SEC-4-подобный паттерн).
    if (!company) throw new NotFoundException('Компания не найдена');
    // TG5: чат уже привязан к ДРУГОЙ компании — явная ошибка вместо падения на unique-констрейнте.
    const already = await this.companyRepo.findOne({ where: { telegramWorkChatId: chatId } });
    if (already && already.id !== companyId) {
      throw new BadRequestException(`Этот чат уже привязан к компании «${already.name}» — сначала отвяжите его там`);
    }
    // Повторная привязка того же чата не должна слать второе приветствие (дубль в чат клиента).
    const wasBound = company.telegramWorkChatId === chatId;
    company.telegramWorkChatId = chatId;
    company.telegramBindCode = null;
    await this.companyRepo.save(company);
    const detected = await this.detectedRepo.findOne({ where: { chatId } });
    if (detected) {
      detected.boundCompanyId = companyId;
      await this.detectedRepo.save(detected);
    }
    this.logger.log(`TG: chat ${chatId} bound to company ${companyId} (from UI)`);
    if (!wasBound) await this.sendMessage(chatId, WORK_CHAT_WELCOME);
    return company;
  }

  /**
   * Привязать рабочий чат к компании по одноразовому bind-коду. Само bind-сообщение НЕ считаем
   * стартом работы (это активация, не работа); старт зафиксирует первая рабочая активность после
   * привязки, либо трекер поставит дату вручную. Ответ в чат — нейтральный, без коммерческих деталей
   * (триал/даты видит только трекер в админке, команда клиента их видеть не должна).
   */
  private async bindWorkChat(code: string, chatId: string): Promise<void> {
    const company = await this.companyRepo.findOne({ where: { telegramBindCode: code } });
    if (!company) {
      // молча: не сорим ошибками в живой чат при неверном коде
      this.logger.warn(`TG: bind-код не найден: ${code}`);
      return;
    }
    // Дубль-защита: если чат уже привязан к этой компании (напр. авто по /start-коду, а потом
    // трекер ещё жмёт «Привязать») — не слать второе приветствие.
    const wasBound = company.telegramWorkChatId === chatId;
    company.telegramWorkChatId = chatId;
    company.telegramBindCode = null; // одноразовый
    await this.companyRepo.save(company);
    // Отмечаем чат привязанным в реестре — иначе он остаётся в списке «Привязать» в UI, и трекер
    // жмёт кнопку повторно (лишний шаг + второе сообщение в чат). Это и был двойной клик.
    const detected = await this.detectedRepo.findOne({ where: { chatId } });
    if (detected) {
      detected.boundCompanyId = company.id;
      await this.detectedRepo.save(detected);
    }
    this.logger.log(`TG: чат ${chatId} привязан к компании ${company.id}`);
    if (!wasBound) await this.sendMessage(chatId, WORK_CHAT_WELCOME);
  }

  /** Первая рабочая активность в привязанном чате = дата старта работы (ставится один раз, тихо). */
  private async markWorkStartFromChat(chatId: string, eventAt: Date): Promise<void> {
    const company = await this.companyRepo.findOne({
      where: { telegramWorkChatId: chatId, workStartedAt: IsNull() },
    });
    if (!company) return;
    company.workStartedAt = eventAt;
    // При режиме «уже внедрение» лицензия бесплатна на весь этап — триал не считаем.
    company.trialEndsAt = company.licenseMode === 'implementation' ? null : computeTrialEnd(eventAt, company.trialDays);
    await this.companyRepo.save(company);
    // Тихо: никаких сообщений в чат команды (даты старта/триала — только трекеру в админке).
    this.logger.log(`TG: старт работы компании ${company.id} = ${eventAt.toISOString()}`);
  }

  // ── Отправка ─────────────────────────────────────────────────────────────

  // COMM1: без ретрая транзиентный сбой (Telegram 429 при рассылке многим компаниям в один
  // и тот же локальный час, короткий сетевой сбой) терял сообщение безвозвратно — крон
  // отправляет его ровно один раз в срок (день/неделю/месяц) и не возвращается к неудачным.
  // Один повтор по retry_after (429) или после короткой паузы (сеть) закрывает основной
  // транзиентный случай без новой инфраструктуры очередей/send-log.
  async sendMessage(recipient: string, text: string, button?: { text: string; url: string }, _retried = false): Promise<boolean> {
    if (!this.enabled) {
      this.logger.debug(`[skip] TG disabled: ${text.slice(0, 60)}`);
      return false;
    }
    const chatId = await this.resolveChatId(recipient);
    if (!chatId) {
      return false;
    }
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          ...(button ? { reply_markup: { inline_keyboard: [[{ text: button.text, url: button.url }]] } } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 429 && !_retried) {
          const retryAfterSec = Math.min(parseRetryAfterSec(body), 5);
          this.logger.debug(`TG 429 for ${recipient}, retry in ${retryAfterSec}s`);
          await sleep(retryAfterSec * 1000);
          return this.sendMessage(recipient, text, button, true);
        }
        this.logger.warn(`TG send failed for ${recipient}: ${res.status} ${body}`);
        return false;
      }
      return true;
    } catch (err) {
      if (!_retried) {
        await sleep(500);
        return this.sendMessage(recipient, text, button, true);
      }
      this.logger.warn(`TG send error for ${recipient}: ${(err as Error).message}`);
      return false;
    }
  }

  async sendToMany(recipients: string[], text: string, button?: { text: string; url: string }): Promise<number> {
    let sent = 0;
    for (const id of recipients) {
      if (await this.sendMessage(id, text, button)) sent++;
    }
    return sent;
  }
}

// ── Хелперы ──────────────────────────────────────────────────────────────────

/** Конец бесплатного периода = старт работы + trialDays. */
export function computeTrialEnd(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Единое экранирование для Telegram parse_mode=HTML. Все сообщения собираются
 * конкатенацией строк с намеренными <b>-тегами вокруг ДИНАМИЧЕСКИХ значений
 * (company.name, fullName и т.п.) — раньше escapeHtml был локальной копией в
 * одном из 4 планировщиков и применялся не везде (TG1/COMM1): сломанное имя
 * компании/сотрудника ломало разбор Telegram → 400 → тихий сбой алертов всей
 * компании, плюс открывало путь для фишинг-ссылки внутри «безобидного» имени.
 * Экранировать КАЖДОЕ динамическое значение перед вставкой в HTML-текст сообщения.
 */
export function escapeTelegramHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** retry_after (сек) из тела ответа Telegram 429: {"ok":false,"parameters":{"retry_after":N}}. */
function parseRetryAfterSec(body: string): number {
  try {
    const parsed = JSON.parse(body) as { parameters?: { retry_after?: number } };
    const sec = parsed.parameters?.retry_after;
    return typeof sec === 'number' && sec > 0 ? sec : 1;
  } catch {
    return 1;
  }
}

// ── Типы апдейтов Telegram (минимально нужное) ───────────────────────────────

interface TgMessage {
  text?: string;
  date?: number; // Unix seconds
  from?: { username?: string };
  chat?: { id?: number; type?: string; title?: string };
}

interface TgMyChatMember {
  chat?: { id?: number; type?: string; title?: string };
  new_chat_member?: { status?: string };
}

interface TgUpdate {
  update_id?: number;
  message?: TgMessage;
  my_chat_member?: TgMyChatMember;
}
