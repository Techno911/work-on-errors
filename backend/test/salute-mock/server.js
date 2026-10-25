/**
 * Мок SaluteSpeech для локального e2e пайплайна транскрипции (без ключа Сбера).
 * Запуск: node test/salute-mock/server.js [порт]
 * Backend направляется на мок через env:
 *   SALUTE_AUTH_KEY=mock SALUTE_OAUTH_URL=http://localhost:4499/oauth SALUTE_API_BASE=http://localhost:4499/rest/v1
 * Задача "созревает" через 20 секунд — успеваем увидеть статус transcribing в UI.
 */
const http = require('http');

const PORT = parseInt(process.argv[2] || '4499', 10);
const tasks = new Map(); // taskId -> createdAt

const DIALOG = [
  { results: [{ normalized_text: 'Добрый день, компания «демо-компании», меня зовут Юрий, слушаю вас.' }], speaker_info: { speaker_id: 0 } },
  { results: [{ normalized_text: 'Здравствуйте, я по поводу замены масла, сколько будет стоить на Солярис?' }], speaker_info: { speaker_id: 1 } },
  { results: [{ normalized_text: 'Подскажите, пожалуйста, год выпуска и пробег, чтобы я подобрал масло.' }], speaker_info: { speaker_id: 0 } },
  { results: [{ normalized_text: 'Две тысячи двадцатый, пробег около восьмидесяти тысяч.' }], speaker_info: { speaker_id: 1 } },
  { results: [{ normalized_text: 'С работой и фильтром выйдет четыре тысячи двести. Могу записать вас на завтра на десять утра.' }], speaker_info: { speaker_id: 0 } },
  { results: [{ normalized_text: 'Давайте, записывайте.' }], speaker_info: { speaker_id: 1 } },
];

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  if (url.pathname === '/oauth') {
    return send(200, { access_token: 'mock-token', expires_at: Date.now() + 30 * 60_000 });
  }
  if (url.pathname === '/rest/v1/data:upload') {
    req.resume();
    return req.on('end', () => send(200, { result: { request_file_id: 'file-' + Date.now() } }));
  }
  if (url.pathname === '/rest/v1/speech:async_recognize') {
    const id = 'task-' + Date.now();
    tasks.set(id, Date.now());
    req.resume();
    return req.on('end', () => send(200, { result: { id, status: 'NEW' } }));
  }
  if (url.pathname === '/rest/v1/task:get') {
    const id = url.searchParams.get('id');
    const created = tasks.get(id);
    if (!created) return send(200, { result: { status: 'ERROR', error: 'задача не найдена' } });
    if (Date.now() - created < 20_000) return send(200, { result: { status: 'RUNNING' } });
    return send(200, { result: { status: 'DONE', response_file_id: 'resp-' + id } });
  }
  if (url.pathname === '/rest/v1/data:download') {
    return send(200, DIALOG);
  }
  send(404, { error: 'not found' });
}).listen(PORT, () => console.log(`SaluteSpeech mock on :${PORT}`));
