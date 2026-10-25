import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * SSRF-защита для URL записи звонка, полученного ИЗ ДАННЫХ CRM (не введённого owner'ом
 * при подключении). baseUrl портала уже проверяется отдельным whitelist-гвардом при
 * upsertConnection — но ссылка на запись приходит внутри ответа CRM API (note.params.link
 * в amoCRM, CALL_RECORD_URL/DISK.FILE.GET в Битрикс24), и её фактически может проставить
 * кто угодно, у кого есть право писать в CRM клиента. Без этой проверки такая ссылка на
 * `http://169.254.169.254/...` или `http://backend:3000/internal` заставила бы наш же
 * сервер сходить во внутреннюю сеть с полными правами воркера импорта звонков.
 */
export function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  return isBlockedIp(h);
}

function isBlockedIp(addr: string): boolean {
  const family = isIP(addr);
  if (family === 4) {
    const [a, b] = addr.split('.').map(Number);
    if (a === 127 || a === 10 || a === 0) return true; // loopback, RFC1918 /8, "this network"
    if (a === 169 && b === 254) return true; // link-local (включает 169.254.169.254 — cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 /12
    if (a === 192 && b === 168) return true; // RFC1918 /16
    return false;
  }
  if (family === 6) {
    const a = addr.toLowerCase();
    if (a === '::1') return true; // loopback
    if (a.startsWith('fe80:') || a.startsWith('fe80::')) return true; // link-local
    if (a.startsWith('fc') || a.startsWith('fd')) return true; // unique-local (fc00::/7)
    if (a.startsWith('::ffff:')) return isBlockedIp(a.slice(7)); // IPv4-mapped
    return false;
  }
  return false; // не IP-литерал — резолвится ниже как hostname
}

/**
 * Бросает при недопустимом адресе. Резолвит DNS (не только текстовый hostname), чтобы
 * ловить DNS rebinding — домен, который выглядит публичным, но резолвится в приватный IP.
 */
export async function assertSafeRecordingUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Некорректная ссылка на запись');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Ссылка на запись должна быть http(s)');
  }
  if (isBlockedHost(url.hostname)) {
    throw new Error('Ссылка на запись указывает на внутренний адрес');
  }
  if (isIP(url.hostname)) return url; // уже IP-литерал, isBlockedHost его проверил
  let addresses: string[];
  try {
    const resolved = await lookup(url.hostname, { all: true });
    addresses = resolved.map((r) => r.address);
  } catch {
    throw new Error('Не удалось разрешить адрес записи');
  }
  if (addresses.some((ip) => isBlockedIp(ip))) {
    throw new Error('Ссылка на запись резолвится во внутренний адрес');
  }
  return url;
}

const MAX_REDIRECTS = 5;

/**
 * fetch с ручной обработкой редиректов: каждый Location проверяется SSRF-гвардом заново,
 * а не только исходный URL (redirect:'follow' иначе доверяет ответу сервера-получателя).
 */
export async function fetchRecordingSafely(
  rawUrl: string,
  init: { signal: AbortSignal },
): Promise<Response> {
  let current = await assertSafeRecordingUrl(rawUrl);
  for (let i = 0; i < MAX_REDIRECTS; i++) {
    const res = await fetch(current, { signal: init.signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      const next = new URL(res.headers.get('location')!, current);
      current = await assertSafeRecordingUrl(next.toString());
      continue;
    }
    return res;
  }
  throw new Error('Слишком много редиректов при скачивании записи');
}
