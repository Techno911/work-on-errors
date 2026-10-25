#!/usr/bin/env node
/**
 * Гейт: форму добавления записи нельзя показывать в закрытой неделе.
 *
 * Бэкенд принимает запись только в активный спринт (entries.service.ts,
 * «Запись можно добавить только в активный спринт», 400). До 10.08.2026 фронт
 * об этом не знал: на завершённом спринте кнопки «Добавить звонок/переписку»
 * рисовались как обычно, менеджер выбирал файл, ждал загрузку и получал отказ.
 * У одного клиента так сгорело 26 попыток подряд за один вечер.
 *
 * Замок стоит на ПОВЕРХНОСТИ, а не на файле, где нашлась ошибка: обходим всё
 * дерево src и требуем, чтобы КАЖДЫЙ рендер <AddEntryForm> и каждая кнопка
 * добавления стояли под условием активности спринта. Появится вторая точка
 * входа (другая страница, мобильный экран) — она обязана нести то же условие.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './gate-shared.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

// Признак «здесь учтён статус спринта»: либо сам предикат, либо сравнение статуса.
const GUARD = /sprintIsActive|sprint\.status\s*===\s*'active'/;
// Окно перед JSX-узлом, в котором обязано стоять условие показа.
const WINDOW = 240;

function walk(dir, files = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, files); continue; }
    if (/\.tsx$/.test(name)) files.push(full);
  }
  return files;
}

const problems = [];
let formRenders = 0;
let addButtons = 0;

for (const file of walk(ROOT)) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const rel = file.replace(ROOT, 'src');

  // 1. Рендер самой формы
  for (const m of code.matchAll(/<AddEntryForm[\s>]/g)) {
    formRenders++;
    const before = code.slice(Math.max(0, m.index - WINDOW), m.index);
    if (!GUARD.test(before)) {
      problems.push(`${rel}: <AddEntryForm> рендерится без проверки статуса спринта`);
    }
  }

  // 2. Кнопки, открывающие форму на текущей доске
  for (const m of code.matchAll(/onClick=\{\(\)\s*=>\s*handleAddClick\(/g)) {
    addButtons++;
    const before = code.slice(Math.max(0, m.index - WINDOW * 3), m.index);
    if (!GUARD.test(before)) {
      problems.push(`${rel}: кнопка добавления записи показывается без проверки статуса спринта`);
    }
  }
}

// Ненайденная цель роняет прогон: иначе переименование компонента сделает гейт
// тождественно зелёным и он молча перестанет что-либо стеречь.
if (formRenders === 0) {
  console.error('\n✗ no-add-entry-on-closed-sprint: рендер <AddEntryForm> не найден вовсе.');
  console.error('  Компонент переименовали или перенесли — обновите гейт, иначе он слеп.\n');
  process.exit(1);
}
if (addButtons === 0) {
  console.error('\n✗ no-add-entry-on-closed-sprint: кнопок добавления записи не найдено.');
  console.error('  Изменился обработчик handleAddClick — обновите гейт, иначе он слеп.\n');
  process.exit(1);
}

if (problems.length) {
  console.error('\n✗ Добавление записи предлагается в неделе, которую сервер не примет (400).');
  console.error('  Человек заполнит форму и загрузит файл ради отказа. Закройте показ условием');
  console.error("  sprintIsActive (sprint.status === 'active') и дайте путь в текущую неделю.");
  for (const p of problems) console.error('  ' + p);
  console.error('');
  process.exit(1);
}

console.log(`✓ no-add-entry-on-closed-sprint: ${formRenders} рендер(ов) формы и ${addButtons} кнопк(и) закрыты статусом спринта`);
