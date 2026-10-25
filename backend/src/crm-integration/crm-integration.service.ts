import {
  Injectable, Logger, NotFoundException, BadRequestException, ServiceUnavailableException, HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, In } from 'typeorm';
import { join } from 'path';
import { randomUUID, randomBytes } from 'crypto';
import * as fs from 'fs';
import { CrmConnection, CrmProviderKey } from './entities/crm-connection.entity';
import { SecretsService } from './secrets.service';
import { Bitrix24Provider } from './providers/bitrix24.provider';
import { AmoCrmProvider } from './providers/amocrm.provider';
import { CrmProvider, CrmConnectionCtx, CrmCall } from './providers/crm-provider.interface';
import { CrmError, CrmErrorCode } from './errors/crm-error';
import { Entry } from '../entries/entities/entry.entity';
import { EntryType } from '../entries/enums/entry-type.enum';
import { Company } from '../companies/entities/company.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/enums/user-role.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { TelegramService, escapeTelegramHtml } from '../analytics/telegram.service';
import { StaffNotifierService } from '../analytics/staff-notifier.service';
import * as bcrypt from 'bcryptjs';

export interface CrmConnectionView {
  provider: CrmProviderKey;
  baseUrl: string;
  secretMasked: string;
  status: string;
  lastCheckAt: Date | null;
  lastError: string | null;
  userMap: Record<string, string>;
}

export interface CrmCallListItem {
  id: string;
  startedAt: string;
  direction: 'in' | 'out';
  phone: string;
  durationSec: number;
  recordingState: string;
  alreadyImported: boolean;
}

/** Подсказка о подключении CRM для команды клиента. show=false — показывать нечего. */
export interface CrmHint {
  show: boolean;
  /** Сколько дней команда уже работает: подсказка приходит не в первый день. */
  daysWorking?: number;
  /** Сколько звонков уже загружено руками: цена ручного пути в понятных числах. */
  manualCalls?: number;
  /** Трекера уже позвали: не предлагаем позвать второй раз. */
  helpRequested?: boolean;
}

const STAGING_DIR = () => join(process.cwd(), 'uploads', 'audio', 'staging');
const MAX_RANGE_DAYS = 31;
// Подсказка про CRM приходит не в первый день работы: у команды сначала онбординг, доступы
// и первые разборы. Десять дней это примерно вторая рабочая неделя, когда ручная загрузка
// уже прочувствована, но привычка ещё не закрепилась.
const CRM_HINT_MIN_DAYS = 10;
const CRM_HINT_SNOOZE_DAYS = 7;
// Листинг звонков amo стоит 20–30 сек (N+1 к notes). Кэшируем на 3 минуты по
// userId+период, чтобы выбор звонка не запускал тот же тяжёлый запрос второй раз.
const CALLS_CACHE_TTL_MS = 3 * 60_000;
// Ссылка-поручение администратору CRM клиента: живёт две недели — столько реально занимает
// «дойти до администратора портала» на онбординге, и при этом она не висит вечно в чужом чате.
const SETUP_LINK_TTL_DAYS = 14;
const APP_URL = process.env.APP_URL || 'https://app.example.invalid';

/**
 * Транзиентные коды (rate limit, сеть) НЕ переводят интеграцию в error:
 * иначе случайная сетевая заминка глушит CRM всей компании без пути восстановления.
 * Такие ошибки логируем и оставляем как есть — следующий вызов или почасовой re-test починит.
 */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([CrmErrorCode.RATE_LIMITED, CrmErrorCode.NETWORK]);

@Injectable()
export class CrmIntegrationService {
  private readonly logger = new Logger(CrmIntegrationService.name);
  /** Кэш листинга звонков по ключу userId+период (см. CALLS_CACHE_TTL_MS). */
  private readonly callsCache = new Map<string, { calls: CrmCall[]; expires: number }>();

  constructor(
    @InjectRepository(CrmConnection) private readonly connRepo: Repository<CrmConnection>,
    @InjectRepository(Entry) private readonly entryRepo: Repository<Entry>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly secrets: SecretsService,
    private readonly bitrix24: Bitrix24Provider,
    private readonly amocrm: AmoCrmProvider,
    private readonly notifications: NotificationsService,
    private readonly telegram: TelegramService,
    private readonly notifier: StaffNotifierService,
  ) {}

  private providerFor(key: CrmProviderKey): CrmProvider {
    if (key === 'bitrix24') return this.bitrix24;
    return this.amocrm;
  }

  private async ctxFor(conn: CrmConnection): Promise<CrmConnectionCtx> {
    return { baseUrl: conn.baseUrl, secret: this.secrets.decrypt(conn.secretEncrypted) };
  }

  private toView(conn: CrmConnection, secretPlain?: string): CrmConnectionView {
    return {
      provider: conn.provider,
      baseUrl: conn.baseUrl,
      secretMasked: this.secrets.mask(secretPlain ?? '????????'),
      status: conn.status,
      lastCheckAt: conn.lastCheckAt,
      lastError: conn.lastError,
      userMap: conn.userMap ?? {},
    };
  }

  // ===== Owner: настройка подключения =====

  async getConnection(companyId: string): Promise<CrmConnectionView | null> {
    const conn = await this.connRepo.findOne({ where: { companyId } });
    if (!conn) return null;
    let plain = '????????';
    try { plain = this.secrets.decrypt(conn.secretEncrypted); } catch { /* маска по умолчанию */ }
    return this.toView(conn, plain);
  }

  /**
   * Создаёт/заменяет подключение. Для Б24 принимаем вебхук-URL ЦЕЛИКОМ
   * (https://portal.bitrix24.ru/rest/123/abc123/) — нетехник вставит как есть.
   */
  async upsertConnection(
    companyId: string,
    dto: { provider: CrmProviderKey; webhookUrl?: string; baseUrl?: string; secret?: string },
    createdBy: string | null,
  ): Promise<CrmConnectionView & { test: { ok: boolean; accountName?: string; errorCode?: string } }> {
    if (!this.secrets.configured) {
      throw new ServiceUnavailableException('Хранилище секретов не настроено (CRM_ENCRYPTION_KEY). Обратитесь в поддержку «ЧиП».');
    }
    let baseUrl: string; let secret: string;
    if (dto.provider === 'bitrix24') {
      const raw = (dto.webhookUrl ?? '').trim();
      const m = raw.match(/^(https?:\/\/[^/]+\/rest\/\d+)\/([a-z0-9]+)\/?/i);
      if (!m) {
        throw new BadRequestException('Не похоже на URL входящего вебхука Битрикс24. Скопируйте его целиком, вида https://ваш-портал.bitrix24.ru/rest/1/код/');
      }
      baseUrl = m[1];
      secret = m[2];
    } else {
      baseUrl = (dto.baseUrl ?? '').trim().replace(/\/$/, '');
      if (baseUrl && !/^https?:\/\//.test(baseUrl)) baseUrl = `https://${baseUrl}`;
      secret = (dto.secret ?? '').trim();
      if (!baseUrl || !secret) throw new BadRequestException('Укажите адрес аккаунта (например, mycompany.amocrm.ru) и долгосрочный токен');
    }

    // SSRF-защита: backend будет ходить по baseUrl. Запрещаем внутренние адреса (localhost,
    // docker-имена, приватные диапазоны) и требуем публичный домен провайдера — иначе owner
    // заставит сервер стучать в localhost/postgres и сканировать внутреннюю сеть по таймингу.
    {
      let host = '';
      try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { throw new BadRequestException('Некорректный адрес CRM'); }
      const internal = host === 'localhost' || host === '::1' || host.endsWith('.local') || !host.includes('.')
        || /^(127\.|0\.|10\.|169\.254\.|192\.168\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
      const okDomain = dto.provider === 'bitrix24'
        ? /\.bitrix24\.[a-z]{2,3}$/.test(host)
        : /(\.amocrm\.(ru|com)|\.kommo\.com)$/.test(host);
      if (internal || !okDomain) {
        throw new BadRequestException(dto.provider === 'bitrix24'
          ? 'Адрес должен быть публичным порталом Битрикс24 (например, ваш-портал.bitrix24.ru)'
          : 'Адрес должен быть публичным доменом amoCRM (amocrm.ru, amocrm.com или kommo.com)');
      }
    }

    const existing = await this.connRepo.findOne({ where: { companyId } });
    const conn = existing ?? this.connRepo.create({ companyId, createdBy });
    const providerChanged = existing && existing.provider !== dto.provider;
    conn.provider = dto.provider;
    conn.baseUrl = baseUrl;
    conn.secretEncrypted = this.secrets.encrypt(secret);
    if (providerChanged) conn.userMap = {}; // смена CRM сбрасывает маппинг атомарно

    // Сразу проверяем подключение, чтобы owner увидел результат одним действием
    let test: { ok: boolean; accountName?: string; errorCode?: string };
    try {
      const result = await this.providerFor(dto.provider).testConnection({ baseUrl, secret });
      conn.status = 'ok';
      conn.lastError = null;
      test = { ok: true, accountName: result.accountName };
    } catch (err) {
      const code = err instanceof CrmError ? err.code : CrmErrorCode.UNKNOWN;
      // Транзиентный сбой при подключении не калечим в error: оставляем «не проверено»,
      // почасовой re-test и кнопка «Проверить подключение» доведут до ok.
      conn.status = TRANSIENT_CODES.has(code) ? 'unverified' : 'error';
      conn.lastError = code;
      test = { ok: false, errorCode: code };
    }
    conn.lastCheckAt = new Date();
    const saved = await this.connRepo.save(conn);

    // Источник «Битрикс24» появляется в SourceSelector менеджеров
    if (test.ok) await this.ensureCallSource(companyId, dto.provider === 'bitrix24' ? 'Битрикс24' : 'amoCRM');

    return { ...this.toView(saved, secret), test };
  }

  private async ensureCallSource(companyId: string, sourceName: string): Promise<void> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (company && !company.callSources.includes(sourceName)) {
      company.callSources = [...company.callSources, sourceName];
      await this.companyRepo.save(company);
    }
  }

  async deleteConnection(companyId: string): Promise<void> {
    const conn = await this.connRepo.findOne({ where: { companyId } });
    await this.connRepo.delete({ companyId });
    // Авто-источник («Битрикс24»/«amoCRM») жив только пока есть интеграция: при отключении
    // убираем его из списка, чтобы менеджеры не видели мёртвый пункт в выборе источника.
    // Удаляем лишь когда по нему нет ни одной записи — иначе у старых записей пропадёт источник.
    if (conn) {
      const sourceName = conn.provider === 'bitrix24' ? 'Битрикс24' : 'amoCRM';
      const inUse = await this.entryRepo.count({ where: { companyId, source: sourceName } });
      if (!inUse) await this.removeCallSource(companyId, sourceName);
    }
  }

  private async removeCallSource(companyId: string, sourceName: string): Promise<void> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (company && company.callSources.includes(sourceName)) {
      company.callSources = company.callSources.filter(s => s !== sourceName);
      await this.companyRepo.save(company);
    }
  }

  async testConnection(companyId: string): Promise<{ ok: boolean; accountName?: string; errorCode?: string }> {
    const conn = await this.requireConnection(companyId);
    try {
      const result = await this.providerFor(conn.provider).testConnection(await this.ctxFor(conn));
      await this.connRepo.update(conn.id, { status: 'ok', lastError: null, lastCheckAt: new Date() });
      return { ok: true, accountName: result.accountName };
    } catch (err) {
      const code = err instanceof CrmError ? err.code : CrmErrorCode.UNKNOWN;
      await this.markFailure(conn, code);
      return { ok: false, errorCode: code };
    }
  }

  /**
   * Фиксирует неудачную проверку подключения. Транзиентные коды не переводят в error
   * (только обновляем lastCheckAt, чтобы было видно живость). На переходе ok→error
   * уведомляем владельцев — иначе сбой замечают только когда менеджеры жалуются.
   */
  private async markFailure(conn: CrmConnection, code: string): Promise<void> {
    if (TRANSIENT_CODES.has(code)) {
      this.logger.warn(`CRM ${conn.provider} (company ${conn.companyId}): транзиентная ошибка ${code} — статус не меняем`);
      await this.connRepo.update(conn.id, { lastCheckAt: new Date() });
      return;
    }
    const wasOk = conn.status !== 'error';
    await this.connRepo.update(conn.id, { status: 'error', lastError: code, lastCheckAt: new Date() });
    if (wasOk) await this.notifyOwnersOfError(conn.companyId, code);
  }

  private async notifyOwnersOfError(companyId: string, code: string): Promise<void> {
    try {
      const owners = await this.userRepo.find({ where: { companyId, role: UserRole.OWNER } });
      for (const owner of owners) {
        await this.notifications.create({
          userId: owner.id,
          type: NotificationType.CRM_ERROR,
          title: 'Проблема с подключением CRM',
          message: 'Платформа перестала получать данные из CRM. Откройте «Настройки → Интеграции» и нажмите «Проверить подключение».',
          linkUrl: '/settings?tab=integrations',
        });
      }
    } catch (e) {
      this.logger.warn(`Не удалось уведомить владельцев о сбое CRM (company ${companyId}): ${e}`);
    }
  }

  /** Почасовой re-test упавших интеграций: транзиентный сбой не должен глушить CRM навсегда. */
  async retestFailedConnections(): Promise<void> {
    const failed = await this.connRepo.find({ where: { status: 'error' } });
    for (const conn of failed) {
      try {
        await this.providerFor(conn.provider).testConnection(await this.ctxFor(conn));
        await this.connRepo.update(conn.id, { status: 'ok', lastError: null, lastCheckAt: new Date() });
        this.logger.log(`CRM ${conn.provider} (company ${conn.companyId}) восстановилась при авто-проверке`);
      } catch {
        await this.connRepo.update(conn.id, { lastCheckAt: new Date() });
      }
    }
  }

  private async requireConnection(companyId: string): Promise<CrmConnection> {
    const conn = await this.connRepo.findOne({ where: { companyId } });
    if (!conn) throw new NotFoundException('CRM не подключена');
    return conn;
  }

  // ===== Owner: маппинг менеджеров =====

  async listCrmUsers(companyId: string) {
    const conn = await this.requireConnection(companyId);
    return this.providerFor(conn.provider).listUsers(await this.ctxFor(conn));
  }

  /** Автосопоставление по email (без учёта регистра). Возвращает итог для UI. */
  async autoMap(companyId: string): Promise<{ matched: number; unmatched: string[]; userMap: Record<string, string> }> {
    const conn = await this.requireConnection(companyId);
    const crmUsers = await this.providerFor(conn.provider).listUsers(await this.ctxFor(conn));
    const byEmail = new Map(crmUsers.filter(u => u.email).map(u => [u.email as string, u.id]));
    const ourManagers = await this.userRepo.find({ where: { companyId, role: In([UserRole.MANAGER, UserRole.REVIEWER]) } });

    const userMap: Record<string, string> = { ...(conn.userMap ?? {}) };
    const unmatched: string[] = [];
    let matched = 0;
    for (const u of ourManagers) {
      const crmId = byEmail.get(u.email.toLowerCase());
      if (crmId) { userMap[u.id] = crmId; matched++; }
      else if (!userMap[u.id]) unmatched.push(u.fullName ?? u.email);
    }
    await this.connRepo.update(conn.id, { userMap });
    return { matched, unmatched, userMap };
  }

  async updateMapping(companyId: string, userMap: Record<string, string>): Promise<Record<string, string>> {
    const conn = await this.requireConnection(companyId);
    // Ключи — только пользователи этой компании
    const ours = await this.userRepo.find({ where: { companyId } });
    const ourIds = new Set(ours.map(u => u.id));
    const clean: Record<string, string> = {};
    for (const [userId, crmUserId] of Object.entries(userMap)) {
      if (ourIds.has(userId) && crmUserId) clean[userId] = String(crmUserId);
    }
    await this.connRepo.update(conn.id, { userMap: clean });
    return clean;
  }

  /**
   * Владелец на онбординге импортирует выбранных сотрудников из CRM как команду (менеджеры/РОП).
   * Заводит аккаунты с временными паролями (возвращаются владельцу один раз). Уже существующие
   * по email — тихо пропускаются (идемпотентно). Владелец может завести только менеджеров и РОПов.
   */
  async importTeam(
    companyId: string,
    members: Array<{ fullName: string; email: string; role: string }>,
  ): Promise<Array<{ fullName: string; email: string; role: string; tempPassword: string }>> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    const allowed = new Set<string>([UserRole.MANAGER, UserRole.REVIEWER]);
    const created: Array<{ fullName: string; email: string; role: string; tempPassword: string }> = [];
    for (const m of members ?? []) {
      const email = (m.email ?? '').toLowerCase().trim();
      const fullName = (m.fullName ?? '').trim();
      if (!email || !fullName || !allowed.has(m.role)) continue;
      const existing = await this.userRepo.findOne({ where: { email } });
      if (existing) continue;
      const tempPassword = genTempPassword();
      const user = this.userRepo.create({
        fullName,
        email,
        role: m.role as UserRole,
        companyId,
        password: await bcrypt.hash(tempPassword, 10),
      });
      await this.userRepo.save(user);
      created.push({ fullName, email, role: m.role, tempPassword });
    }
    return created;
  }

  /**
   * Владелец не разобрался с подключением CRM и просит помощь трекера. Ставит флаг в карточке
   * компании, шлёт in-app уведомление трекерам/суперадминам и дубль в служебный Telegram ЧиП.
   */
  async requestHelp(companyId: string): Promise<{ requested: true }> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');
    company.crmHelpRequestedAt = new Date();
    await this.companyRepo.save(company);

    const staff = await this.userRepo.find({ where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }] });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.HELP_REQUESTED,
        title: 'Владелец просит помощь с CRM',
        message: `Компания «${company.name}»: владелец не разобрался с подключением CRM на онбординге.`,
        linkUrl: `/admin/company/${companyId}`,
      });
    }
    // Дубль в служебный Telegram-чат ЧиП, чтобы увидели сразу: человек ждёт ответа.
    await this.notifier.alert(
      'crm-help',
      `🆘 Владелец компании <b>${escapeTelegramHtml(company.name)}</b> просит помощь с подключением CRM на онбординге.`,
    );
    return { requested: true };
  }

  // ===== Ссылка-поручение администратору CRM клиента =====

  /**
   * Выдаёт ссылку, по которой администратор портала CRM подключает его САМ, без входа в платформу.
   * Так снимается тупик: вебхук создаётся только внутри портала клиента, доступа туда у трекера нет,
   * а пересказ инструкции в переписке теряется. Ссылка живёт SETUP_LINK_TTL_DAYS дней и гаснет
   * при первом успешном подключении. Повторный вызов выдаёт ту же живую ссылку — чтобы у клиента
   * на руках не оказалось двух разных.
   */
  async createSetupLink(companyId: string, sendToChat: boolean): Promise<{ url: string; sentToChat: boolean; expiresAt: Date }> {
    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    if (!company) throw new NotFoundException('Компания не найдена');

    const alive = company.crmSetupToken
      && company.crmSetupTokenExpiresAt
      && company.crmSetupTokenExpiresAt.getTime() > Date.now();
    if (!alive) {
      company.crmSetupToken = randomUUID().replace(/-/g, '');
      company.crmSetupTokenExpiresAt = new Date(Date.now() + SETUP_LINK_TTL_DAYS * 24 * 60 * 60 * 1000);
      await this.companyRepo.save(company);
    }
    const url = `${APP_URL}/crm-setup/${company.crmSetupToken}`;

    let sentToChat = false;
    if (sendToChat && company.telegramWorkChatId) {
      sentToChat = await this.telegram.sendMessage(
        company.telegramWorkChatId,
        'Коллеги, добрый день.\n\nЧтобы записи звонков подтягивались в платформу сами, нужно один раз связать её с вашей CRM. '
        + 'Это делает тот, у кого есть права администратора портала: по кнопке ниже открывается страница с тремя шагами, входить в платформу для этого не нужно. '
        + 'Займёт пару минут.',
        { text: 'Подключить CRM', url },
      );
    }
    return { url, sentToChat, expiresAt: company.crmSetupTokenExpiresAt! };
  }

  /** Публично: что показать на странице /crm-setup/:token. Секретов не отдаёт. */
  async getSetupInfo(token: string): Promise<{ companyName: string; alreadyConnected: boolean; provider: CrmProviderKey | null }> {
    const company = await this.requireSetupCompany(token);
    const conn = await this.connRepo.findOne({ where: { companyId: company.id } });
    return {
      companyName: company.name,
      alreadyConnected: conn?.status === 'ok',
      provider: conn?.provider ?? null,
    };
  }

  /**
   * Публично: администратор CRM отправил доступ по ссылке-поручению. Подключение идёт тем же
   * путём, что и из платформы (та же проверка портала и та же защита от внутренних адресов),
   * поэтому клиент не может «подключить» что-то, чего не подключил бы трекер руками.
   */
  async submitSetup(
    token: string,
    dto: { provider: CrmProviderKey; webhookUrl?: string; baseUrl?: string; secret?: string },
  ): Promise<{ ok: boolean; accountName?: string; errorCode?: string }> {
    const company = await this.requireSetupCompany(token);
    // Работающее подключение по публичной ссылке не перезаписываем: иначе ошибочная отправка
    // по старой ссылке из чужой переписки оборвёт живую интеграцию всей компании.
    const current = await this.connRepo.findOne({ where: { companyId: company.id } });
    if (current?.status === 'ok') return { ok: true };

    const result = await this.upsertConnection(company.id, dto, null);
    if (!result.test.ok) return result.test;

    // Токен одноразовый: сработал — гасим, чтобы ссылка не жила в чужой переписке дальше.
    company.crmSetupToken = null;
    company.crmSetupTokenExpiresAt = null;
    await this.companyRepo.save(company);

    const staff = await this.userRepo.find({ where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }] });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.CRM_CONNECTED,
        title: 'CRM подключена клиентом',
        message: `Компания «${company.name}»: администратор подключил ${dto.provider === 'bitrix24' ? 'Битрикс24' : 'amoCRM'} по ссылке-поручению. Осталось сопоставить сотрудников.`,
        linkUrl: `/admin/company/${company.id}`,
      });
    }
    return result.test;
  }

  /**
   * Публично: администратор CRM нажал «позовите на помощь» на странице-поручении.
   * Человек по ту сторону ссылки не может написать нам в платформу — без этой кнопки он
   * упирается в тупик молча, и мы узнаём об этом, только когда спросим сами.
   */
  async requestSetupHelp(token: string): Promise<{ requested: true }> {
    const company = await this.requireSetupCompany(token);
    company.crmHelpRequestedAt = new Date();
    await this.companyRepo.save(company);

    const staff = await this.userRepo.find({ where: [{ role: UserRole.TRACKER }, { role: UserRole.SUPERADMIN }] });
    for (const s of staff) {
      await this.notifications.create({
        userId: s.id,
        type: NotificationType.HELP_REQUESTED,
        title: 'Просят помощь с подключением CRM',
        message: `Компания «${company.name}»: администратор CRM не смог подключить портал по ссылке-поручению.`,
        linkUrl: `/admin/company/${company.id}`,
      });
    }
    await this.notifier.alert(
      'crm-help',
      `🆘 Администратор CRM компании <b>${escapeTelegramHtml(company.name)}</b> просит помощь с подключением по ссылке-поручению.`,
    );
    return { requested: true };
  }

  private async requireSetupCompany(token: string): Promise<Company> {
    const clean = (token ?? '').trim();
    const company = clean ? await this.companyRepo.findOne({ where: { crmSetupToken: clean } }) : null;
    if (!company) throw new NotFoundException('Ссылка недействительна. Запросите новую у вашего трекера «ЧиП».');
    if (company.crmSetupTokenExpiresAt && company.crmSetupTokenExpiresAt.getTime() < Date.now()) {
      throw new NotFoundException('Срок действия ссылки истёк. Запросите новую у вашего трекера «ЧиП».');
    }
    return company;
  }

  // ===== Manager: список звонков и подтягивание записи =====

  async myStatus(user: User): Promise<{ connected: boolean; provider?: CrmProviderKey; mapped: boolean }> {
    if (!user.companyId) return { connected: false, mapped: false };
    const conn = await this.connRepo.findOne({ where: { companyId: user.companyId } });
    if (!conn || conn.status === 'error') return { connected: false, mapped: false };
    // CRM-импорт имеет смысл только вместе с транскрипцией: без неё файл не превратится в текст
    const company = await this.companyRepo.findOne({ where: { id: user.companyId } });
    if (!company?.transcription?.enabled) return { connected: false, mapped: false };
    return { connected: true, provider: conn.provider, mapped: Boolean(conn.userMap?.[user.id]) };
  }

  /**
   * Подсказка «подключите CRM» для команды клиента.
   *
   * Зачем: у одного клиента все девятнадцать звонков загружены файлами вручную, из CRM ноль, и
   * именно ручная загрузка порождала жалобы. Подключение никто не запрещал, о нём просто никто
   * не вспомнил после онбординга. Молчание платформы и осознанное решение «подключать нечем»
   * до сих пор выглядели одинаково.
   *
   * Показываем, когда все условия сразу: CRM не подключена, наша команда не отметила «нечем
   * подключать», работа идёт дольше порога и подсказку не откладывали. Иначе это шум.
   */
  async myCrmHint(user: User): Promise<CrmHint> {
    const hidden: CrmHint = { show: false };
    if (!user.companyId) return hidden;
    const company = await this.companyRepo.findOne({ where: { id: user.companyId } });
    if (!company) return hidden;
    // Решение нашей команды: подключать нечем. Молчим до его отмены.
    if (company.crmNotApplicable) return hidden;
    // Отложено самим руководителем.
    if (company.crmHintSnoozedUntil && company.crmHintSnoozedUntil > new Date()) return hidden;
    // Без распознавания звонков импорт из CRM бессмыслен: файл не станет текстом.
    if (!company.transcription?.enabled) return hidden;

    const conn = await this.connRepo.findOne({ where: { companyId: company.id } });
    if (conn && conn.status !== 'error') return hidden;

    const startedAt = company.workStartedAt ?? company.launchedAt;
    if (!startedAt) return hidden;
    const daysWorking = Math.floor((Date.now() - new Date(startedAt).getTime()) / 86_400_000);
    if (daysWorking < CRM_HINT_MIN_DAYS) return hidden;

    // Сколько звонков команда уже загрузила руками: это и есть цена ручного пути, показываем её.
    const manualCalls = await this.entryRepo.count({
      where: { companyId: company.id, type: EntryType.CALL, crmCallId: IsNull() },
    }).catch(() => 0);

    return { show: true, daysWorking, manualCalls, helpRequested: Boolean(company.crmHelpRequestedAt) };
  }

  /** Отложить подсказку на неделю: решение руководителя, а не отказ навсегда. */
  async snoozeCrmHint(user: User): Promise<{ snoozedUntil: Date }> {
    if (!user.companyId) throw new ForbiddenException();
    const until = new Date(Date.now() + CRM_HINT_SNOOZE_DAYS * 86_400_000);
    await this.companyRepo.update({ id: user.companyId }, { crmHintSnoozedUntil: until });
    return { snoozedUntil: until };
  }

  /** Ключ кэша листинга: пользователь + границы периода (с точностью до минуты). */
  private callsCacheKey(userId: string, from: Date, to: Date): string {
    const min = (d: Date) => Math.floor(d.getTime() / 60_000);
    return `${userId}:${min(from)}:${min(to)}`;
  }

  private getCachedCalls(key: string): CrmCall[] | null {
    const hit = this.callsCache.get(key);
    if (!hit) return null;
    if (hit.expires < Date.now()) { this.callsCache.delete(key); return null; }
    return hit.calls;
  }

  private setCachedCalls(key: string, calls: CrmCall[]): void {
    this.callsCache.set(key, { calls, expires: Date.now() + CALLS_CACHE_TTL_MS });
  }

  /**
   * Загружает звонки менеджера за период: сначала из кэша, при промахе — из CRM.
   * Кэш гасит N+1 повторно при выборе звонка (валидация идёт по уже загруженному списку).
   */
  private async loadManagerCalls(conn: CrmConnection, user: User, from: Date, to: Date): Promise<CrmCall[]> {
    const crmUserId = conn.userMap?.[user.id];
    if (!crmUserId) throw new CrmHttp(CrmErrorCode.USER_NOT_MAPPED);
    const key = this.callsCacheKey(user.id, from, to);
    const cached = this.getCachedCalls(key);
    if (cached) return cached;
    const calls = await this.providerFor(conn.provider).listCalls(await this.ctxFor(conn), crmUserId, from, to);
    this.setCachedCalls(key, calls);
    return calls;
  }

  private async resolveManagerCall(user: User, callId: string, from: Date, to: Date): Promise<{ conn: CrmConnection; call: CrmCall }> {
    const conn = await this.requireConnection(user.companyId as string);
    if (!conn.userMap?.[user.id]) throw new CrmHttp(CrmErrorCode.USER_NOT_MAPPED);
    // Валидируем по кэшу листинга (или одному дозагруженному списку) — чужой callId подобрать нельзя
    const calls = await this.loadManagerCalls(conn, user, from, to);
    const call = calls.find(c => c.id === callId);
    if (!call) throw new NotFoundException('Звонок не найден среди ваших звонков за этот период');
    return { conn, call };
  }

  async myCalls(user: User, fromStr?: string, toStr?: string): Promise<CrmCallListItem[]> {
    const conn = await this.requireConnection(user.companyId as string);
    const crmUserId = conn.userMap?.[user.id];
    if (!crmUserId) throw new CrmHttp(CrmErrorCode.USER_NOT_MAPPED);

    const to = toStr ? new Date(`${toStr}T23:59:59`) : new Date();
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(Date.now() - 7 * 86400_000);
    if ((to.getTime() - from.getTime()) / 86400_000 > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Период не больше ${MAX_RANGE_DAYS} дней`);
    }

    let calls: CrmCall[];
    try {
      calls = await this.loadManagerCalls(conn, user, from, to);
    } catch (err) {
      if (err instanceof CrmError) {
        await this.markFailure(conn, err.code);
        throw new CrmHttp(err.code);
      }
      throw err;
    }

    // Пометка «уже добавлен» по crmCallId
    const ids = calls.map(c => c.id);
    const imported = ids.length
      ? await this.entryRepo.find({ where: { companyId: user.companyId as string, crmCallId: In(ids) }, select: ['crmCallId'] })
      : [];
    const importedSet = new Set(imported.map(e => e.crmCallId));
    return calls.map(c => ({
      id: c.id,
      startedAt: c.startedAt,
      direction: c.direction,
      phone: c.phone,
      durationSec: c.durationSec,
      recordingState: c.recordingState,
      alreadyImported: importedSet.has(c.id),
    }));
  }

  /** Скачивает запись в staging СРАЗУ (ссылки CRM протухают) и возвращает черновик для формы. */
  async fetchCall(user: User, callId: string, fromStr?: string, toStr?: string) {
    const to = toStr ? new Date(`${toStr}T23:59:59`) : new Date();
    const from = fromStr ? new Date(`${fromStr}T00:00:00`) : new Date(Date.now() - 7 * 86400_000);

    const existing = await this.entryRepo.findOne({
      where: { companyId: user.companyId as string, crmCallId: callId, deletedAt: IsNull() },
      withDeleted: false,
    });
    if (existing) throw new CrmHttp(CrmErrorCode.ALREADY_IMPORTED);

    const { conn, call } = await this.resolveManagerCall(user, callId, from, to);
    const stagedId = randomUUID();
    fs.mkdirSync(STAGING_DIR(), { recursive: true });
    const destPath = join(STAGING_DIR(), `${stagedId}.mp3`);
    try {
      const { sizeBytes } = await this.providerFor(conn.provider).downloadRecording(await this.ctxFor(conn), call, destPath);
      return {
        stagedRecordingId: stagedId,
        fileName: `Звонок ${call.phone || ''} ${call.startedAt.slice(0, 10)}.mp3`.replace(/\s+/g, ' '),
        sizeBytes,
        callId: call.id,
        provider: conn.provider,
        callDate: call.startedAt.slice(0, 10),
        direction: call.direction,
        phone: call.phone,
        durationSec: call.durationSec,
      };
    } catch (err) {
      fs.rmSync(destPath, { force: true });
      if (err instanceof CrmError) throw new CrmHttp(err.code);
      throw err;
    }
  }

  /** Перемещает staged-файл при создании Entry. Возвращает путь или null, если файл устарел. */
  takeStagedFile(stagedRecordingId: string): { path: string; size: number } | null {
    if (!/^[0-9a-f-]{36}$/i.test(stagedRecordingId)) return null;
    const p = join(STAGING_DIR(), `${stagedRecordingId}.mp3`);
    if (!fs.existsSync(p)) return null;
    return { path: p, size: fs.statSync(p).size };
  }

  /** Чистка staging-файлов старше 24 часов (бросили форму, не доведя до записи). */
  cleanupStaging(): void {
    const dir = STAGING_DIR();
    if (!fs.existsSync(dir)) return;
    const cutoff = Date.now() - 24 * 3600_000;
    for (const f of fs.readdirSync(dir)) {
      const p = join(dir, f);
      try {
        if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
      } catch { /* файл уже забрали */ }
    }
  }
}

/** HTTP-обёртка над CrmErrorCode: фронт мапит code на русский текст из словаря. */
export class CrmHttp extends HttpException {
  constructor(code: CrmErrorCode) {
    const statusByCode: Partial<Record<CrmErrorCode, number>> = {
      [CrmErrorCode.USER_NOT_MAPPED]: 409,
      [CrmErrorCode.ALREADY_IMPORTED]: 409,
      [CrmErrorCode.STAGED_EXPIRED]: 409,
      [CrmErrorCode.RECORD_NOT_READY]: 409,
      [CrmErrorCode.RECORD_IN_PBX]: 409,
      [CrmErrorCode.LINK_EXPIRED]: 410,
      [CrmErrorCode.AUTH_FAILED]: 502,
      [CrmErrorCode.MARKETPLACE_SUBSCRIPTION_REQUIRED]: 502,
      [CrmErrorCode.RATE_LIMITED]: 429,
      [CrmErrorCode.NETWORK]: 502,
    };
    super({ message: code, crmErrorCode: code }, statusByCode[code] ?? 500);
  }
}

/** Криптостойкий временный пароль для аккаунтов, заведённых массово из CRM. */
function genTempPassword(): string {
  return randomBytes(12).toString('base64url');
}
