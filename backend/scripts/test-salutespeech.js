/**
 * Боевой прогон SaluteSpeech без поднятия Nest: node scripts/test-salutespeech.js <файл.mp3>
 * Требует SALUTE_AUTH_KEY (и опц. SALUTE_SCOPE) в окружении или backend/.env.
 * Выводит статусы задачи и готовый диалог в консоль.
 */
const path = require('path');
const fs = require('fs');

// .env подхватываем как Nest (dotenv уже в node_modules)
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env') }); } catch {}

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) {
    console.error('Использование: node scripts/test-salutespeech.js <путь к mp3>');
    process.exit(1);
  }
  if (!process.env.SALUTE_AUTH_KEY) {
    console.error('SALUTE_AUTH_KEY не задан — добавьте ключ из кабинета developers.sber.ru в backend/.env');
    process.exit(1);
  }
  const { SaluteSpeechProvider } = require('../dist/transcription/providers/salutespeech.provider');
  const provider = new SaluteSpeechProvider();
  console.log('Создаём задачу…');
  const { taskId } = await provider.createTask(file);
  console.log('taskId:', taskId);
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await provider.getResult(taskId);
    if (res.status === 'processing') { process.stdout.write('.'); continue; }
    if (res.status === 'failed') { console.error('\nОшибка:', res.error); process.exit(1); }
    console.log('\n--- Диалог ---');
    for (const u of res.utterances) console.log(`Голос ${u.speakerId + 1}: ${u.text}`);
    return;
  }
  console.error('\nТаймаут ожидания (10 минут)');
  process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
