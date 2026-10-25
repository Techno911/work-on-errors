#!/usr/bin/env node
/**
 * Гейт «Что нового»: у каждой выпущенной версии есть РЕШЕНИЕ, рассказывать ли о ней людям.
 *
 * Зачем именно гейт, а не правило в документации: механизм анонсов умирает не от того, что
 * его сломали, а от того, что через месяц забыли заполнить. Проза это не удерживает, свежая
 * сессия её не прочитает. Поэтому решение принуждается сборкой: версия из package.json обязана
 * быть либо описана анонсом в src/content/releases.ts, либо внесена в SILENT_VERSIONS с
 * причиной. Иначе фронт не собирается, а значит и на прод не уедет.
 *
 * «Нет» сознательно дешёвое (одна строка с причиной): гейт, который заставляет писать анонс
 * ради правки вёрстки, приучил бы себя обходить.
 *
 * Проверяем:
 *   1. текущая версия имеет решение (анонс или молчание с причиной);
 *   2. одна версия не может быть одновременно и анонсом, и молчанием;
 *   3. причина молчания осмысленная, а не прочерк для галочки;
 *   4. у анонса есть заголовок, адресаты и хотя бы один слайд (иначе окно-пустышка).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src/content/releases.ts');
const fail = (msg) => { console.error(`✗ release-notes: ${msg}`); process.exit(1); };

const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8')).version;
const text = readFileSync(SRC, 'utf-8');

// Границы блоков: разбираем файл по объявлениям, чтобы «version:» из чужого места
// (например, из примера в комментарии) не сошёл за настоящий анонс.
const releasesBlock = text.slice(
  text.indexOf('export const RELEASES'),
  text.indexOf('export const SILENT_VERSIONS'),
);
const silentBlock = text.slice(
  text.indexOf('export const SILENT_VERSIONS'),
  text.indexOf('export function latestKnownVersion'),
);
if (!releasesBlock || !silentBlock) {
  fail('в src/content/releases.ts не найдены RELEASES и SILENT_VERSIONS. Структура файла изменилась, поправь гейт вместе с ней.');
}

const announced = [...releasesBlock.matchAll(/version:\s*'(\d+\.\d+\.\d+)'/g)].map(m => m[1]);
const silent = [...silentBlock.matchAll(/'(\d+\.\d+\.\d+)'\s*:\s*'([^']*)'/g)]
  .map(m => ({ version: m[1], reason: m[2] }));

// 2. Пересечение списков: непонятно, что делать с такой версией, и поведение станет случайным.
const both = announced.filter(v => silent.some(s => s.version === v));
if (both.length > 0) {
  fail(`версия ${both.join(', ')} значится и анонсом, и молчанием. Оставь что-то одно.`);
}

// 3. Причина молчания должна объяснять решение человеку, который прочитает это через полгода.
for (const s of silent) {
  if (s.reason.trim().length < 20) {
    fail(`у молчаливой версии ${s.version} причина «${s.reason}» слишком короткая. `
       + `Напиши, почему людям об этом знать не нужно (например: «внутренние сигналы трекеру, снаружи ничего не изменилось»).`);
  }
}

// 4. Анонс без содержания хуже отсутствия анонса: человек получит пустое окно.
//    Режем блок по НАЧАЛУ записи (version — первое поле анонса), а не по любой открывающей
//    скобке: скобки есть и у слайдов, из-за них кусок обрывался до slides и проверка врала.
const starts = [...releasesBlock.matchAll(/version:\s*'\d+\.\d+\.\d+'/g)].map(m => m.index);
const entries = starts.map((from, i) => releasesBlock.slice(from, starts[i + 1] ?? releasesBlock.length));
for (const entry of entries) {
  const v = entry.match(/version:\s*'(\d+\.\d+\.\d+)'/)?.[1];
  if (!v) continue;
  if (!/headline:\s*'[^']{10,}'/.test(entry)) {
    fail(`у анонса ${v} пустой или слишком короткий headline: это заголовок окна, он должен говорить о главном.`);
  }
  if (!/audience:\s*\[\s*'/.test(entry)) {
    fail(`у анонса ${v} не указаны адресаты (audience). Кому это показывать?`);
  }
  if (!/slides:\s*\[[\s\S]*?title:\s*'/.test(entry)) {
    fail(`у анонса ${v} нет ни одного слайда.`);
  }
}

// 1. Главная проверка: решение по текущей версии принято.
const isAnnounced = announced.includes(version);
const isSilent = silent.some(s => s.version === version);
if (!isAnnounced && !isSilent) {
  console.error(`✗ release-notes: по версии ${version} нет решения, рассказывать ли о ней пользователям.`);
  console.error('');
  console.error('  Платформа меняется, а люди узнают об этом случайно. Выбери одно из двух:');
  console.error('');
  console.error(`  1. Есть что рассказать → добавь анонс в src/content/releases.ts (RELEASES, новый сверху):`);
  console.error(`       { version: '${version}', date: '…', headline: '…', audience: ['manager'], slides: [{ icon: 'sparkles', title: '…', body: '…' }] }`);
  console.error(`     Пиши о том, что человек ТЕПЕРЬ МОЖЕТ СДЕЛАТЬ, а не что «добавлено поле».`);
  console.error('');
  console.error(`  2. Снаружи ничего не изменилось → одна строка в SILENT_VERSIONS:`);
  console.error(`       '${version}': 'коротко, почему людям об этом знать не нужно',`);
  process.exit(1);
}

const verdict = isAnnounced ? 'анонс для пользователей' : 'молча (решение зафиксировано)';
console.log(`✓ release-notes: v${version} — ${verdict}`);
