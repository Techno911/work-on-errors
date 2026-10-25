#!/usr/bin/env node
/**
 * Гейт против длинного тире «—» (U+2014) в КЛИЕНТСКОМ тексте.
 * По правилу ЧиП em-dash в клиентском UI — табу («палит ИИ»): замена на
 * двоеточие / запятую / точку / скобки / «·», между числами — короткое тире «–».
 * Комментарии кода (//, /* *​/, {/* *​/}, JSDoc) — внутренние, там «—» допустимо
 * и НЕ ловится: они вырезаются до проверки.
 * Запускается в build (package.json) → и в прод-сборке Docker: новый em-dash
 * в строке/JSX-тексте физически не доедет до прода. Нашёл — билд падает с адресом.
 *
 * Комментарии режем построчно (block /* *​/ через флаг inBlock, line // кроме ://).
 * Строковые/regex-литералы НЕ токенизируем намеренно: regex с бэктиком внутри
 * ломает наивную стейт-машину, а построчный срез комментариев от этого не страдает.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const EM = '—'; // —

// Возвращает номера строк (1-based), где после вырезания комментариев остаётся «—».
function clientEmDashLines(text) {
  const lines = text.split('\n');
  let inBlock = false;
  const hits = [];
  lines.forEach((raw, idx) => {
    let s = raw, out = '', i = 0;
    while (i < s.length) {
      if (inBlock) {
        const e = s.indexOf('*/', i);
        if (e < 0) { i = s.length; } else { i = e + 2; inBlock = false; }
        continue;
      }
      let bc = s.indexOf('/*', i);
      let lc = s.indexOf('//', i);
      while (lc > 0 && s[lc - 1] === ':') lc = s.indexOf('//', lc + 2); // пропускаем :// в URL
      if (lc < 0 && bc < 0) { out += s.slice(i); break; }
      if (bc < 0 || (lc >= 0 && lc < bc)) { out += s.slice(i, lc); break; } // // до конца строки
      out += s.slice(i, bc);
      const e = s.indexOf('*/', bc + 2);
      if (e < 0) { inBlock = true; break; }
      i = e + 2;
    }
    if (out.includes(EM)) hits.push(idx + 1);
  });
  return hits;
}

function walk(dir) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { hits.push(...walk(full)); continue; }
    if (!/\.(ts|tsx)$/.test(name) || /\.d\.ts$/.test(name)) continue;
    for (const ln of clientEmDashLines(readFileSync(full, 'utf8'))) {
      hits.push(`${full.replace(ROOT, 'src')}:${ln}`);
    }
  }
  return hits;
}

const hits = walk(ROOT);
if (hits.length) {
  console.error('\n✗ Длинное тире «—» в клиентском тексте (строка/JSX). В UI это табу.');
  console.error('  Замена: «:» перед пояснением, запятая/точка, скобки, «·» в мета-строках, между числами «–» (U+2013).');
  for (const h of hits) console.error('  ' + h);
  console.error('  (Внутри комментариев кода «—» допустимо и гейтом не ловится.)\n');
  process.exit(1);
}
console.log('✓ no-em-dash: длинного тире в клиентском тексте нет');
