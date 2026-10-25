/**
 * Мок REST Битрикс24 для локального e2e CRM-интеграции.
 * Запуск: node test/bitrix-mock/server.js [порт=4498]
 * Вебхук для подключения: http://localhost:4498/rest/1/goodsecret/
 * Сценарии по секрету в URL:
 *   goodsecret  — всё работает (3 звонка: ready / processing / external_pbx)
 *   nosub       — портал без подписки Маркетплейс
 *   badsecret   — неверный токен
 */
const http = require('http');

const PORT = parseInt(process.argv[2] || '4498', 10);

// Настоящий MP3 (3 секунды), чтобы ffprobe/ffmpeg его приняли
const FAKE_MP3 = require('fs').readFileSync(require('path').join(__dirname, 'sample.mp3'));

const NOW = Date.now();
const iso = ms => new Date(ms).toISOString();
const CALLS = [
  {
    ID: '1001', CALL_START_DATE: iso(NOW - 2 * 3600_000), CALL_TYPE: '2',
    PHONE_NUMBER: '+79161234567', CALL_DURATION: '247',
    CALL_RECORD_URL: `http://localhost:${PORT}/record/1001.mp3`, RECORD_FILE_ID: 501,
    REST_APP_ID: null, CALL_FAILED_CODE: '200', PORTAL_USER_ID: '7',
  },
  {
    ID: '1002', CALL_START_DATE: iso(NOW - 40 * 60_000), CALL_TYPE: '1',
    PHONE_NUMBER: '+79031112233', CALL_DURATION: '95',
    CALL_RECORD_URL: '', RECORD_FILE_ID: null,
    REST_APP_ID: null, CALL_FAILED_CODE: '200', PORTAL_USER_ID: '7', // processing
  },
  {
    ID: '1003', CALL_START_DATE: iso(NOW - 26 * 3600_000), CALL_TYPE: '2',
    PHONE_NUMBER: '+79998887766', CALL_DURATION: '312',
    CALL_RECORD_URL: '', RECORD_FILE_ID: null,
    REST_APP_ID: 'mango_app', CALL_FAILED_CODE: '200', PORTAL_USER_ID: '7', // external_pbx
  },
];

const USERS = [
  { ID: '7', NAME: 'Юрий', LAST_NAME: 'Тестов', EMAIL: 'yuri@test.com', ACTIVE: true },
  { ID: '8', NAME: 'Елена', LAST_NAME: 'Тестова', EMAIL: 'elena@test.com', ACTIVE: true },
  { ID: '9', NAME: 'Кто-то', LAST_NAME: 'Несовпавший', EMAIL: 'other@crm.ru', ACTIVE: true },
];

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  // Скачивание записи
  if (url.pathname === '/record/1001.mp3') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': FAKE_MP3.length });
    return res.end(FAKE_MP3);
  }

  const m = url.pathname.match(/^\/rest\/(\d+)\/([a-z0-9]+)\/([a-z._]+)\.json$/i);
  if (!m) return send(404, { error: 'NOT_FOUND' });
  const [, , secret, method] = m;

  if (secret === 'badsecret') return send(401, { error: 'INVALID_CREDENTIALS', error_description: 'Неверный токен вебхука' });
  if (secret === 'nosub') return send(403, { error: 'ACCESS_DENIED', error_description: 'REST API is available only with active Marketplace subscription tariff' });
  if (secret !== 'goodsecret') return send(401, { error: 'INVALID_CREDENTIALS', error_description: 'unknown secret' });

  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const params = body ? JSON.parse(body) : {};
    if (method === 'profile') return send(200, { result: { NAME: 'Андрей', LAST_NAME: 'Админов' } });
    if (method === 'user.get') return send(200, { result: USERS });
    if (method === 'voximplant.statistic.get') {
      const f = params.FILTER ?? {};
      let rows = CALLS;
      if (f.PORTAL_USER_ID) rows = rows.filter(c => c.PORTAL_USER_ID === String(f.PORTAL_USER_ID));
      const from = f['>=CALL_START_DATE'] ? new Date(f['>=CALL_START_DATE']).getTime() : 0;
      const to = f['<=CALL_START_DATE'] ? new Date(f['<=CALL_START_DATE']).getTime() : Infinity;
      rows = rows.filter(c => { const t = new Date(c.CALL_START_DATE).getTime(); return t >= from && t <= to; });
      return send(200, { result: rows, total: rows.length });
    }
    if (method === 'disk.file.get') {
      return send(200, { result: { DOWNLOAD_URL: `http://localhost:${PORT}/record/1001.mp3` } });
    }
    send(200, { result: [] });
  });
}).listen(PORT, () => console.log(`Bitrix24 mock on :${PORT}`));
