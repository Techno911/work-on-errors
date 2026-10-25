import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { CrmProvider, CrmConnectionCtx, CrmUser, CrmCall, RecordingState } from './crm-provider.interface';
import { CrmError, CrmErrorCode } from '../errors/crm-error';
import { fetchRecordingSafely } from '../ssrf-guard';

const PAGE_SIZE = 50;
const MAX_PAGES = 20; // потолок выборки за период — 1000 звонков
const DOWNLOAD_LIMIT = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;

interface B24Call {
  ID: string;
  CALL_START_DATE: string;
  CALL_TYPE: string; // 1 исходящий, 2 входящий, 3 переадресация, 4 callback
  PHONE_NUMBER: string;
  CALL_DURATION: string;
  CALL_RECORD_URL: string;
  RECORD_FILE_ID: number | null;
  REST_APP_ID: string | null;
  CALL_FAILED_CODE: string;
}

/**
 * Битрикс24 через входящий вебхук (бессрочный токен, наследует права создателя).
 * baseUrl: https://portal.bitrix24.ru/rest/{user_id} ; secret: код вебхука.
 * voximplant.statistic.get покрывает и встроенную телефонию, и Mango/UIS
 * (их externalcall-звонки попадают в ту же статистику).
 * Лимит REST: leaky bucket 2 rps — последовательные запросы с паузой + retry.
 */
@Injectable()
export class Bitrix24Provider implements CrmProvider {
  readonly key = 'bitrix24' as const;
  private readonly logger = new Logger(Bitrix24Provider.name);

  /**
   * Единый разбор ошибки Битрикс24 в CrmError. Возвращает null, если запрос успешен
   * (есть retry-сигнал — обрабатывает вызывающий код). Используется и в call(), и в callPaged(),
   * чтобы реальная причина (нет подписки Маркетплейс и т.п.) доходила до пользователя,
   * а не подменялась общим «неверный токен».
   */
  private parseB24Error(
    error: string,
    errorDescription: string | undefined,
    httpStatus: number,
  ): { retry: boolean; err?: CrmError } {
    const code = String(error).toUpperCase();
    if (code === 'QUERY_LIMIT_EXCEEDED' || httpStatus === 503) {
      return { retry: true };
    }
    // Портал без подписки Маркетплейс отдаёт отдельные коды доступа к REST
    if (['ACCESS_DENIED', 'INSUFFICIENT_SCOPE', 'ALLOWED_ONLY_INTRANET_USER'].includes(code) &&
        /subscription|market|tariff/i.test(errorDescription ?? '')) {
      return { retry: false, err: new CrmError(CrmErrorCode.MARKETPLACE_SUBSCRIPTION_REQUIRED, errorDescription) };
    }
    if (['EXPIRED_TOKEN', 'INVALID_CREDENTIALS', 'ACCESS_DENIED', 'INVALID_REQUEST', 'ERROR_METHOD_NOT_FOUND'].includes(code)) {
      return { retry: false, err: new CrmError(CrmErrorCode.AUTH_FAILED, `${code}: ${(errorDescription ?? '').slice(0, 120)}`) };
    }
    return { retry: false, err: new CrmError(CrmErrorCode.UNKNOWN, `${code}: ${(errorDescription ?? '').slice(0, 120)}`) };
  }

  private async call<T>(ctx: CrmConnectionCtx, method: string, params: Record<string, unknown> = {}, attempt = 0): Promise<T> {
    const url = `${ctx.baseUrl.replace(/\/$/, '')}/${ctx.secret}/${method}.json`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new CrmError(CrmErrorCode.NETWORK, (err as Error).message);
    }
    const data = (await res.json().catch(() => ({}))) as {
      result?: T; error?: string; error_description?: string; next?: number; total?: number;
    };
    if (data.error) {
      const parsed = this.parseB24Error(data.error, data.error_description, res.status);
      if (parsed.retry) {
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
          return this.call(ctx, method, params, attempt + 1);
        }
        throw new CrmError(CrmErrorCode.RATE_LIMITED, String(data.error).toUpperCase());
      }
      throw parsed.err;
    }
    if (!res.ok) throw new CrmError(CrmErrorCode.NETWORK, `HTTP ${res.status}`);
    return data.result as T;
  }

  /** Постраничная выборка list-метода (страницы по 50, пауза 600 мс — держимся под 2 rps). */
  private async callPaged<T>(ctx: CrmConnectionCtx, method: string, params: Record<string, unknown>): Promise<T[]> {
    const all: T[] = [];
    let start = 0;
    let retries = 0; // отдельный от page счётчик — раньше `page--` откатывал MAX_PAGES при
    // каждом rate-limit ответе, и цикл мог не завершиться никогда (page топтался на месте).
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${ctx.baseUrl.replace(/\/$/, '')}/${ctx.secret}/${method}.json`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, start }),
        signal: AbortSignal.timeout(30_000),
      }).catch(err => { throw new CrmError(CrmErrorCode.NETWORK, (err as Error).message); });
      const data = (await res.json().catch(() => ({}))) as { result?: T[]; error?: string; error_description?: string; next?: number };
      if (data.error) {
        // Тот же разбор, что и в call(): реальная причина (нет подписки Маркетплейс и т.п.)
        // должна доходить до пользователя, а не подменяться общим AUTH_FAILED.
        const parsed = this.parseB24Error(data.error, data.error_description, res.status);
        if (parsed.retry) {
          if (++retries > 3) throw new CrmError(CrmErrorCode.RATE_LIMITED, String(data.error).toUpperCase());
          await new Promise(r => setTimeout(r, 1500 * retries));
          page--; continue;
        }
        throw parsed.err;
      }
      all.push(...(data.result ?? []));
      if (data.next === undefined) break;
      start = data.next;
      await new Promise(r => setTimeout(r, 600));
    }
    return all;
  }

  async testConnection(ctx: CrmConnectionCtx): Promise<{ ok: true; accountName: string }> {
    // profile — самый лёгкий метод; заодно проверяет валидность вебхука
    const profile = await this.call<{ NAME?: string; LAST_NAME?: string }>(ctx, 'profile');
    // и что выдан скоуп telephony
    await this.call(ctx, 'voximplant.statistic.get', { FILTER: {}, SORT: 'CALL_START_DATE', ORDER: 'DESC' });
    const host = new URL(ctx.baseUrl).hostname;
    const name = [profile?.NAME, profile?.LAST_NAME].filter(Boolean).join(' ');
    return { ok: true, accountName: name ? `${host} (${name})` : host };
  }

  async listUsers(ctx: CrmConnectionCtx): Promise<CrmUser[]> {
    const users = await this.callPaged<{ ID: string; NAME?: string; LAST_NAME?: string; EMAIL?: string; ACTIVE?: boolean }>(
      ctx, 'user.get', { FILTER: { ACTIVE: true } },
    );
    return users.map(u => ({
      id: String(u.ID),
      name: [u.NAME, u.LAST_NAME].filter(Boolean).join(' ') || `Пользователь ${u.ID}`,
      email: u.EMAIL?.toLowerCase() ?? null,
    }));
  }

  private recordingState(c: B24Call): RecordingState {
    if (c.CALL_RECORD_URL || c.RECORD_FILE_ID) return 'ready';
    const dur = parseInt(c.CALL_DURATION, 10) || 0;
    if (dur <= 0) return 'none';
    // Сторонняя интеграция (Mango/UIS) не передала запись — она осталась в АТС
    if (c.REST_APP_ID) return 'external_pbx';
    // Запись встроенной телефонии появляется с задержкой после конца разговора
    return 'processing';
  }

  async listCalls(ctx: CrmConnectionCtx, crmUserId: string, from: Date, to: Date): Promise<CrmCall[]> {
    const rows = await this.callPaged<B24Call>(ctx, 'voximplant.statistic.get', {
      FILTER: {
        PORTAL_USER_ID: crmUserId,
        '>=CALL_START_DATE': from.toISOString(),
        '<=CALL_START_DATE': to.toISOString(),
      },
      SORT: 'CALL_START_DATE',
      ORDER: 'DESC',
    });
    return rows.map(c => ({
      id: String(c.ID),
      startedAt: c.CALL_START_DATE,
      direction: c.CALL_TYPE === '1' ? 'out' as const : 'in' as const,
      phone: c.PHONE_NUMBER ?? '',
      durationSec: parseInt(c.CALL_DURATION, 10) || 0,
      recordingState: this.recordingState(c),
      raw: { recordUrl: c.CALL_RECORD_URL || null, recordFileId: c.RECORD_FILE_ID ?? null },
    }));
  }

  async downloadRecording(ctx: CrmConnectionCtx, call: CrmCall, destPath: string): Promise<{ sizeBytes: number }> {
    const raw = (call.raw ?? {}) as { recordUrl?: string | null; recordFileId?: number | null };
    if (call.recordingState === 'external_pbx') throw new CrmError(CrmErrorCode.RECORD_IN_PBX);
    if (call.recordingState !== 'ready') throw new CrmError(CrmErrorCode.RECORD_NOT_READY);

    let url = raw.recordUrl ?? null;
    if (!url && raw.recordFileId) {
      // Fallback: файл записи на Диске Б24 (нужен скоуп disk)
      const file = await this.call<{ DOWNLOAD_URL?: string }>(ctx, 'disk.file.get', { id: raw.recordFileId });
      url = file?.DOWNLOAD_URL ?? null;
    }
    if (!url) throw new CrmError(CrmErrorCode.RECORD_NOT_READY);

    // url пришёл из CALL_RECORD_URL/disk.file.get — из данных портала, а не из baseUrl,
    // который owner ввёл и который прошёл whitelist-проверку при подключении (SSRF-риск).
    let res: Response;
    try {
      res = await fetchRecordingSafely(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      throw new CrmError(CrmErrorCode.NETWORK, (err as Error).message);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || contentType.includes('text/html')) {
      // Ссылка протухла или требует живой сессии — честный отказ
      throw new CrmError(CrmErrorCode.LINK_EXPIRED, `HTTP ${res.status} ${contentType}`);
    }
    const len = parseInt(res.headers.get('content-length') ?? '0', 10);
    if (len > DOWNLOAD_LIMIT) throw new CrmError(CrmErrorCode.UNKNOWN, 'Файл записи больше 200 МБ');
    if (!res.body) throw new CrmError(CrmErrorCode.NETWORK, 'Пустое тело ответа');

    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(destPath));
    const { size } = await stat(destPath);
    if (size === 0) throw new CrmError(CrmErrorCode.LINK_EXPIRED, 'Скачался пустой файл');
    return { sizeBytes: size };
  }
}
