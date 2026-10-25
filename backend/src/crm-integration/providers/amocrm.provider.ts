import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'fs';
import { stat } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { CrmProvider, CrmConnectionCtx, CrmUser, CrmCall } from './crm-provider.interface';
import { CrmError, CrmErrorCode } from '../errors/crm-error';
import { fetchRecordingSafely } from '../ssrf-guard';

const DOWNLOAD_LIMIT = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
// amo держит 7 rps на интеграцию. Тянем notes пачками по 5 параллельно с паузой между пачками,
// оставаясь под лимитом, но не платя 160 мс за каждый звонок последовательно.
const NOTE_BATCH = 5;
const BATCH_PAUSE_MS = 800;

interface AmoEvent {
  id: string;
  type: string; // incoming_call | outgoing_call
  created_at: number; // unix sec
  entity_id: number;
  entity_type: string; // lead | contact | company
  value_after?: { note?: { id: number } }[];
}

interface AmoUsersPage {
  _embedded?: { users?: { id: number; name?: string; email?: string; rights?: { is_admin?: boolean } }[] };
  _links?: { next?: { href?: string } };
}

interface AmoNote {
  id: number;
  note_type: string; // call_in | call_out
  params?: {
    link?: string;
    duration?: number;
    phone?: string;
    call_responsible?: string | number;
  };
}

/**
 * amoCRM через долгосрочный токен (Bearer, до 5 лет, без refresh-цепочки).
 * baseUrl: https://subdomain.amocrm.ru ; secret: долгосрочный токен.
 * Файл записи в amo НЕ хранится — только ссылка на CDN провайдера телефонии,
 * ссылки протухают (у некоторых АТС через 30 дней) → качаем сразу при выборе.
 */
@Injectable()
export class AmoCrmProvider implements CrmProvider {
  readonly key = 'amocrm' as const;
  private readonly logger = new Logger(AmoCrmProvider.name);

  private async api<T>(ctx: CrmConnectionCtx, path: string, attempt = 0): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${ctx.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${ctx.secret}` },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new CrmError(CrmErrorCode.NETWORK, (err as Error).message);
    }
    if (res.status === 429) {
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        return this.api(ctx, path, attempt + 1);
      }
      throw new CrmError(CrmErrorCode.RATE_LIMITED);
    }
    if (res.status === 401 || res.status === 403) {
      throw new CrmError(CrmErrorCode.AUTH_FAILED, `HTTP ${res.status}`);
    }
    if (res.status === 402) {
      // Подписка amoCRM закончилась — API закрыт
      throw new CrmError(CrmErrorCode.MARKETPLACE_SUBSCRIPTION_REQUIRED, 'Подписка amoCRM закончилась');
    }
    if (res.status === 204) return { _embedded: {} } as T; // пустой список
    if (!res.ok) throw new CrmError(CrmErrorCode.UNKNOWN, `HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async testConnection(ctx: CrmConnectionCtx): Promise<{ ok: true; accountName: string }> {
    const acc = await this.api<{ name?: string; subdomain?: string }>(ctx, '/api/v4/account');
    return { ok: true, accountName: acc.name || acc.subdomain || new URL(ctx.baseUrl).hostname };
  }

  async listUsers(ctx: CrmConnectionCtx): Promise<CrmUser[]> {
    // Порталы крупнее 250 человек amo отдаёт постранично — идём по _links.next,
    // иначе сотрудники со «второй страницы» выпадают из маппинга.
    const users: CrmUser[] = [];
    let path: string | null = '/api/v4/users?limit=250';
    let page = 0;
    while (path && page < 40) {
      const data: AmoUsersPage = await this.api<AmoUsersPage>(ctx, path);
      for (const u of data._embedded?.users ?? []) {
        users.push({
          id: String(u.id),
          name: u.name || `Пользователь ${u.id}`,
          email: u.email?.toLowerCase() ?? null,
          isAdmin: u.rights?.is_admin ?? false,
        });
      }
      const next = data._links?.next?.href;
      path = next ? new URL(next).pathname + new URL(next).search : null;
      page++;
    }
    return users;
  }

  async listCalls(ctx: CrmConnectionCtx, crmUserId: string, from: Date, to: Date): Promise<CrmCall[]> {
    // События звонков фильтруются по создателю — это и есть изоляция «только свои звонки»
    const q = new URLSearchParams();
    q.append('filter[type][]', 'incoming_call');
    q.append('filter[type][]', 'outgoing_call');
    q.append('filter[created_by][]', crmUserId);
    q.set('filter[created_at][from]', String(Math.floor(from.getTime() / 1000)));
    q.set('filter[created_at][to]', String(Math.floor(to.getTime() / 1000)));
    q.set('limit', '100');
    const data = await this.api<{ _embedded?: { events?: AmoEvent[] } }>(ctx, `/api/v4/events?${q.toString()}`);
    const events = data._embedded?.events ?? [];

    const withNote = events.filter(ev => ev.value_after?.[0]?.note?.id && ev.entity_id && ev.entity_type);

    const calls: CrmCall[] = [];
    // Тянем notes пачками: внутри пачки — параллельно, между пачками — пауза.
    for (let i = 0; i < withNote.length; i += NOTE_BATCH) {
      const batch = withNote.slice(i, i + NOTE_BATCH);
      if (i > 0) await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
      const resolved = await Promise.all(batch.map(async ev => {
        const noteId = ev.value_after![0].note!.id;
        let note: AmoNote | null = null;
        try {
          // entity_type из события единственного числа (lead) → путь во множественном (leads)
          const entityPath = ev.entity_type.endsWith('s') ? ev.entity_type : `${ev.entity_type}s`;
          note = await this.api<AmoNote>(ctx, `/api/v4/${entityPath}/${ev.entity_id}/notes/${noteId}`);
        } catch (err) {
          // Примечание могли удалить — звонок показываем без записи
          this.logger.warn(`amo note ${noteId} не прочитано: ${(err as Error).message}`);
        }
        const link = note?.params?.link;
        return {
          id: String(noteId),
          startedAt: new Date(ev.created_at * 1000).toISOString(),
          direction: (ev.type === 'outgoing_call' ? 'out' : 'in') as 'in' | 'out',
          phone: note?.params?.phone ?? '',
          durationSec: note?.params?.duration ?? 0,
          recordingState: (link ? 'ready' : 'none') as 'ready' | 'none',
          raw: { link: link ?? null },
        };
      }));
      calls.push(...resolved);
    }
    return calls;
  }

  async downloadRecording(ctx: CrmConnectionCtx, call: CrmCall, destPath: string): Promise<{ sizeBytes: number }> {
    const link = ((call.raw ?? {}) as { link?: string | null }).link;
    if (!link) throw new CrmError(CrmErrorCode.RECORD_NOT_READY);

    // Запись лежит на CDN АТС (Mango/UIS/Sipuni/...) — обычно публичная по секретной ссылке.
    // link пришёл из note.params CRM клиента — не тот же baseUrl, что owner ввёл при подключении
    // и который прошёл whitelist-проверку; сюда может дотянуться кто угодно, у кого есть право
    // писать заметки в CRM клиента (SSRF на внутреннюю сеть нашего сервера).
    let res: Response;
    try {
      res = await fetchRecordingSafely(link, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (err) {
      throw new CrmError(CrmErrorCode.NETWORK, (err as Error).message);
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || contentType.includes('text/html')) {
      // АТС хранит записи ограниченное время; протухшая ссылка отдаёт 403/404/HTML
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
