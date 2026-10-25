/** Отладочный дамп сырого ответа SaluteSpeech (структура чанков). */
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const OAUTH = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const API = 'https://smartspeech.sber.ru/rest/v1';

async function main() {
  const file = process.argv[2];
  const tok = await (await fetch(OAUTH, {
    method: 'POST',
    headers: { Authorization: `Basic ${process.env.SALUTE_AUTH_KEY}`, RqUID: randomUUID(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `scope=${process.env.SALUTE_SCOPE}`,
  })).json();
  const H = { Authorization: `Bearer ${tok.access_token}` };
  const up = await (await fetch(`${API}/data:upload`, { method: 'POST', headers: { ...H, 'Content-Type': 'audio/mpeg' }, body: fs.readFileSync(file) })).json();
  const task = await (await fetch(`${API}/speech:async_recognize`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ options: { language: 'ru-RU', audio_encoding: 'MP3', channels_count: 1, speaker_separation_options: { enable: true, enable_only_main_speaker: false, count: 2 } }, request_file_id: up.result.request_file_id }),
  })).json();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const st = await (await fetch(`${API}/task:get?id=${task.result.id}`, { headers: H })).json();
    if (st.result.status === 'DONE') {
      const data = await (await fetch(`${API}/data:download?response_file_id=${st.result.response_file_id}`, { headers: H })).json();
      console.log('chunks:', data.length);
      for (const c of data.slice(0, 6)) {
        console.log(JSON.stringify({ speaker_info: c.speaker_info, channel: c.channel, eou: c.eou, keys: Object.keys(c), text: c.results?.[0]?.normalized_text?.slice(0, 40) }));
      }
      return;
    }
    if (st.result.status === 'ERROR') { console.error(st.result); return; }
    process.stdout.write('.');
  }
}
main().catch(e => { console.error(e); process.exit(1); });
