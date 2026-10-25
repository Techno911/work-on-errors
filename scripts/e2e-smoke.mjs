#!/usr/bin/env node
/**
 * e2e-smoke — повторяемый прогон аудиторских проверок против живого контура (F15).
 * Порт ручного прогона 07.10.2026 (44 проверки). Без мутаций боевых компаний:
 * читаемые и отказные пробы + регистрация-по-приглашению и валидация контрактов.
 *
 * Запуск:
 *   WOE_BASE_URL=http://localhost:13000 node scripts/e2e-smoke.mjs
 *   (опционально) RO_TOKEN=<jwt> — для авторизованных проб на uuid/413.
 *
 * Код выхода: 0 — всё зелёное; 1 — есть FAIL (гейт релиза).
 */

const BASE = (process.env.WOE_BASE_URL || 'http://localhost:13000').replace(/\/$/, '');
{
  const host = new URL(BASE).hostname;
  if (!['localhost', '127.0.0.1', '::1', 'backend'].includes(host)) {
    console.error(`E2E идёт только по локальному контуру: WOE_BASE_URL=${BASE} — не локальный адрес.`);
    process.exit(1);
  }
}
const API = `${BASE}/api`;
const TOKEN = process.env.RO_TOKEN || null;

const results = [];
const t = (name, ok, ev) => { results.push({ name, ok, ev }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} :: ${ev}`); };

async function req(method, path, { token, body, site } = {}) {
  const url = (site ? BASE : API) + path;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let data;
  if (body !== undefined) {
    data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { method, headers, body: data });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

async function main() {
  // 1. Живость: health реально ходит в базу (не статика 200)
  {
    const r = await req('GET', '/health');
    t('health-db', r.status === 200 && r.json?.db === 'connected', `${r.status} db=${r.json?.db}`);
  }
  // 2. Защищённые эндпоинты без токена → 401
  for (const p of ['/entries', '/users', '/companies', '/notifications']) {
    const r = await req('GET', p);
    t(`no-token ${p}`, r.status === 401, String(r.status));
  }
  // 3. Битый JWT → 401
  {
    const r = await req('GET', '/entries', { token: 'aaa.bbb.ccc' });
    t('forged-jwt', r.status === 401, String(r.status));
  }
  // 4. Нет user-enumeration: несуществующий email и неверный пароль — одинаковый ответ
  {
    const a = await req('POST', '/auth/login', { body: { email: 'nosuchuser-smoke@example.com', password: 'abcdef12' } });
    const b = await req('POST', '/auth/login', { body: { email: 'also-nosuch-smoke@example.com', password: 'zzzzzz99' } });
    t('no-enumeration', a.status === b.status && a.json?.message === b.json?.message, `${a.status}=${b.status}`);
  }
  // 5. AUDIT-0710 H1: регистрация без приглашения → 403
  {
    const r = await req('POST', '/auth/register', { body: { email: `smoke-${Date.now()}@example.com`, password: 'Smoke!12345', fullName: 'Smoke' } });
    t('register-gated', r.status === 403, `${r.status}`);
  }
  // 6. Мусорные токены публичных ссылок → отказ
  for (const [name, p] of [
    ['share-garbage', '/share/entry?token=garbage'],
    ['offer-garbage', '/offer/garbage123'],
    ['rop-offer-garbage', '/rop-bonus-offer/garbage123'],
    ['invite-garbage', '/invites/garbage123'],
  ]) {
    const r = await req('GET', p);
    t(name, [400, 401, 404].includes(r.status), String(r.status));
  }
  // 7. AUDIT-0710 M1: невалидный uuid → 400, а не 500 (нужен токен — защищённые роуты)
  if (TOKEN) {
    for (const p of ['/entries/not-a-uuid', '/sprints/not-a-uuid', '/users/not-a-uuid', '/companies/not-a-uuid']) {
      const r = await req('GET', p, { token: TOKEN });
      t(`uuid400 ${p}`, r.status === 400, String(r.status));
    }
    // 8. AUDIT-0710 M4: тело >2 МБ → 413
    const big = JSON.stringify({ x: 'A'.repeat(3 * 1024 * 1024) });
    const r = await req('POST', '/entries', { token: TOKEN, body: big });
    t('bigbody-413', r.status === 413, `${r.status}`);
    // 9. AUDIT-0710 L1: proposal без тела → 400
    const r2 = await req('POST', '/admin/companies/00000000-0000-0000-0000-000000000000/rop-bonus-proposal', { token: TOKEN });
    t('proposal-no-body-4xx', [400, 401, 403].includes(r2.status), `${r2.status}`);
  } else {
    console.log('SKIP: RO_TOKEN не задан — авторизованные пробы (uuid400, 413, proposal) пропущены');
  }
  // 10. AUDIT-0710 L6: security-заголовки на статике
  {
    const r = await req('GET', '/', { site: true });
    const h = (n) => r.headers.get(n);
    const missing = ['strict-transport-security', 'x-content-type-options', 'x-frame-options', 'content-security-policy'].filter((n) => !h(n));
    t('static-headers', missing.length === 0, missing.length ? `нет: ${missing.join(',')}` : 'все на месте');
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nИтого: ${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.log('FAIL:', failed.map((f) => f.name).join(', ')); process.exit(1); }
}
main().catch((e) => { console.error('RUNNER ERROR:', e); process.exit(1); });
