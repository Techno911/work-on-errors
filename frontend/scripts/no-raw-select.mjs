#!/usr/bin/env node
/**
 * Гейт против дрейфа вёрстки: сырой <select> запрещён во всём коде, кроме
 * единственного канонического компонента src/components/ui/input.tsx.
 * Все селекты должны идти через <Select> оттуда (единый шеврон, отступы, темы).
 * Запускается в build (package.json) — значит и в прод-сборке Docker: сырой
 * <select> физически не доедет до прода. Нашёл — билд падает с адресом.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ALLOW = 'components/ui/input.tsx'; // канонический дом <select>
const RAW = /<select[\s>]/;

function walk(dir) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { hits.push(...walk(full)); continue; }
    if (!/\.(tsx|jsx)$/.test(name)) continue;
    if (full.endsWith(ALLOW)) continue;
    const text = readFileSync(full, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (RAW.test(line)) hits.push(`${full.replace(ROOT, 'src')}:${i + 1}`);
    });
  }
  return hits;
}

const hits = walk(ROOT);
if (hits.length) {
  console.error('\n✗ Найден сырой <select>. Используйте <Select> из @/components/ui/input:');
  for (const h of hits) console.error('  ' + h);
  console.error('\nЭто защита от дрейфа вёрстки селектов. Если нужен новый вариант — правьте компонент Select, не заводите сырой тег.\n');
  process.exit(1);
}
console.log('✓ no-raw-select: сырых <select> нет');
