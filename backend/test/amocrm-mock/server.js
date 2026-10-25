/**
 * Мок API amoCRM для локального e2e. Запуск: node test/amocrm-mock/server.js [порт=4497]
 * Подключение: адрес http://localhost:4497, токен goodtoken.
 * Токены: goodtoken — ок; expired — 401; nosub — 402 (подписка кончилась).
 * Записи: note 2001 — живая ссылка; note 2002 — протухшая (отдаёт HTML).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '4497', 10);
const MP3 = fs.readFileSync(path.join(__dirname, '..', 'bitrix-mock', 'sample.mp3'));

const NOW = Math.floor(Date.now() / 1000);
const EVENTS = [
  { id: 'ev1', type: 'incoming_call', created_at: NOW - 3600, created_by: 71, entity_id: 301, entity_type: 'lead', value_after: [{ note: { id: 2001 } }] },
  { id: 'ev2', type: 'outgoing_call', created_at: NOW - 90000, created_by: 71, entity_id: 302, entity_type: 'contact', value_after: [{ note: { id: 2002 } }] },
];
const NOTES = {
  2001: { id: 2001, note_type: 'call_in', params: { link: `http://localhost:${PORT}/records/2001.mp3`, duration: 184, phone: '+79261234567', call_responsible: 'Юрий' } },
  2002: { id: 2002, note_type: 'call_out', params: { link: `http://localhost:${PORT}/records/expired.mp3`, duration: 65, phone: '+79051112233', call_responsible: 71 } },
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type });
    res.end(type === 'application/json' ? JSON.stringify(body) : body);
  };

  if (url.pathname === '/records/2001.mp3') {
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': MP3.length });
    return res.end(MP3);
  }
  if (url.pathname === '/records/expired.mp3') {
    return send(403, '<html><body>Ссылка устарела</body></html>', 'text/html');
  }

  const auth = req.headers.authorization ?? '';
  if (auth.includes('expired')) return send(401, { title: 'Unauthorized' });
  if (auth.includes('nosub')) return send(402, { title: 'Payment Required' });
  if (!auth.includes('goodtoken')) return send(401, { title: 'Unauthorized' });

  if (url.pathname === '/api/v4/account') return send(200, { name: 'демо-компании (тест amo)', subdomain: 'avtoplus' });
  if (url.pathname === '/api/v4/users') {
    return send(200, { _embedded: { users: [
      { id: 71, name: 'Юрий Тестов', email: 'yuri@test.com' },
      { id: 72, name: 'Елена Тестова', email: 'elena@test.com' },
    ] } });
  }
  if (url.pathname === '/api/v4/events') {
    const createdBy = url.searchParams.get('filter[created_by][]');
    const from = parseInt(url.searchParams.get('filter[created_at][from]') ?? '0', 10);
    const to = parseInt(url.searchParams.get('filter[created_at][to]') ?? String(NOW + 1000), 10);
    const events = EVENTS.filter(e => String(e.created_by) === createdBy && e.created_at >= from && e.created_at <= to);
    return send(200, { _embedded: { events } });
  }
  const noteMatch = url.pathname.match(/^\/api\/v4\/(?:leads|contacts|companies)\/\d+\/notes\/(\d+)$/);
  if (noteMatch) {
    const note = NOTES[noteMatch[1]];
    return note ? send(200, note) : send(404, { title: 'Not Found' });
  }
  send(404, { title: 'Not Found', path: url.pathname });
}).listen(PORT, () => console.log(`amoCRM mock on :${PORT}`));
