#!/usr/bin/env node
/**
 * ОТКЛЮЧЁН 23.09.2026 (переезд на @chirkov/shell 0.3.0) — из npm run build
 * снят, файл оставлен как история. Замок стерёг МЕСТНЫЙ блок ролей акцента
 * в index.css (маркеры ACCENT_FAMILY_ROLES_BEGIN/END), а этого блока больше
 * нет: акцент теперь задаёт пакет, значения сверены байт-в-байт со старыми
 * (accent=#b45309, active=#773706, hover=#8f4207, focus=#d16310, …) — увод
 * без замера был бы регрессом, дословное совпадение подтверждено. Дальше
 * несанкционированный сдвиг акцента ловит css-перепись.py пакета (проверка
 * «цвет» против палитры на собранном CSS) и Figma-конвейер самого chip-shell,
 * а не этот файл.
 *
 * ЗАМОК АКЦЕНТА: единственное семейство ролей, осознанные значения и назначения.
 *
 * ПОВОД, КОТОРЫЙ ДОРОГО СТОИЛ. Шаг 3 сводил вторые ступени каждого смысла в
 * одну: у серых, у состояний, у служебного. Акцент по ФОРМЕ выглядел так же
 * (accent-v3-500 рядом с accent, accent-public рядом с ними), и его схлопнули
 * заодно. Это меняло пиксель в 200+ местах: второй оранжевый #F97316 и
 * публичный #EA6D0E становились #FF6900, кольцо фокуса orange-400 → orange-500.
 *
 * ПОЧЕМУ ЭТО НЕ ПОЙМАЛА НИ ОДНА ПРОВЕРКА. Все они спрашивали «изменилось ли
 * ЗНАЧЕНИЕ роли акцента», и ответ был честным «нет»: шесть системных ролей
 * держали свой oklch дословно. Менялось другое — КАКАЯ роль стоит в разметке.
 * Проверка значения по построению слепа к подмене роли.
 *
 * ПОЭТОМУ СЛЕД РОЛЕЙ СОХРАНЁН: одинаковый hex не разрешает подменять
 * назначение. Владелец выбрал янтарь (1133c3d); после разбора миграций
 * 14.09.2026 осталось одно семейство. Новое имя запрещено независимо от
 * содержимого снимка. Значения и упорядоченный след по-прежнему проверяются.
 *
 * МАРШРУТ СМЕНЫ: решение владельца → вычисленные цвета затронутых состояний
 * (или доказанный перенос в общий компонент) → производная писем → снимок
 * с основанием и исходным SHA → ревью diff и коммит с названным решением.
 * Изменение роли при прежнем hex тоже требует этого разбора. Ключа слепой
 * пересъёмки нет. Основание текущего перехода хранится в accent-trace.json.
 * Архив прошлых замеров не переписывается. Самопроверки идут КАЖДЫЙ запуск.
 *
 * РЕШЕНИЯ ВЛАДЕЛЬЦА, 09.09.2026 (второй возврат приёмки):
 * PRESET_COLORS в analytics/TagManager.tsx — пользовательская палитра тегов,
 * не акцент интерфейса. Литерал #F97316 в ней и в собранном frontend законен;
 * это не освобождает дефолт нового тега в backend от общего цвета #B45309.
 * Рамка текстового сообщения #F3C7A5 — декоративное разделение (1,55:1 на
 * белом), а не необходимый признак контрола/состояния. Владелец оставил её
 * при контрасте текста 7,79:1. Это НЕ исключение для фокуса, активного поля
 * или значка управления: для кольца отдельно принят #D16310 (3,82:1).
 * Замок сверяет значения/обращения, а не рассчитывает контраст каждой сцены.
 * Нейтральность кнопочного атома меряется между его before/after SHA при
 * одной палитре. Сравнение старой версии с новой включает принятую смену
 * оранжевого на янтарь; 1,56–8,61% такого сравнения не являются pixel-diff
 * самого переноса Button. Смешивать диапазоны ревизий в отчёте нельзя.
 * Подробности: 07 Внедрение/ro/приёмка-возврат/ВТОРОЙ-ВОЗВРАТ.md.
 *
 * ЗАПУСК:
 *   node no-accent-drift.mjs             проверить
 *   node no-accent-drift.mjs --selftest  самопроверка сломом
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync,
  writeFileSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { stripComments } from './gate-shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const SNAP = join(HERE, 'accent-trace.json');
function прямойЗапуск(entry, moduleUrl) {
  return Boolean(entry && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl)));
}
// Это словарь назначений, а не вторая палитра. Значения живут в index.css.
// Словарь независим от снимка: пересъёмка не может узаконить второе семейство.
export const РОЛИ = Object.freeze([
  'accent-subtle', 'accent-muted', 'accent', 'accent-solid', 'accent-strong',
  'accent-fg', 'accent-ring', 'accent-pressed', 'accent-subtle-alt',
  'accent-muted-alt', 'accent-fg-alt', 'accent-public',
]);
const ДОПУСТИМЫЕ = new Set(РОЛИ);
const МАРКЕРЫ = ['/* ACCENT_FAMILY_ROLES_BEGIN */', '/* ACCENT_FAMILY_ROLES_END */'];
const УТИЛ = '(?:bg|text|border-[trblxyse]|border|ring-offset|ring|outline|divide|' +
  'from|via|to|fill|stroke|accent|caret|decoration|placeholder|shadow)';
// Не фильтруем словарём: неизвестное имя обязано попасть в проверку.
// Включены var(..., fallback), Tailwind bg-(--color-...), конфиги и emailColor.
const ССЫЛКА = new RegExp(
  `(?<![\\w-])${УТИЛ}-(accent(?:-[\\w-]+)?)(?![\\w-])|` +
  `--(?:color-)?(accent(?:-[\\w-]+)?)(?![\\w-])|` +
  `["'\x60](?:color-)?(accent(?:-[\\w-]+)?)["'\x60]`, 'g');

export function след(text) {
  const code = stripComments(text).replace(/<!--[\s\S]*?-->/g, '');
  return [...code.matchAll(ССЫЛКА)]
    // class="accent-line" — имя локального CSS-селектора, не цветовая роль.
    // bg-accent-... внутри того же атрибута попадает через первую ветку.
    .filter(m => !m[3] || !/\bclass(?:Name)?\s*=\s*$/.test(code.slice(0, m.index)))
    .map(m => m[1] || m[2] || m[3]);
}

function файлы(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'dist', '.git', 'coverage', '.vite'].includes(entry.name) || entry.isSymbolicLink()) return [];
    const full = join(root, entry.name);
    if (entry.isDirectory()) return файлы(full);
    if (/(?:package-lock|pnpm-lock|yarn\.lock)/.test(entry.name)) return [];
    return /\.(?:[cm]?[jt]sx?|css|scss|sass|less|html|svg|json|ya?ml|py|sh)$/.test(entry.name) || entry.name === 'Dockerfile' ? [full] : [];
  }).sort();
}

/** Обе сборки, их статика и конфигурация. Исторический архив не исполняется. */
export function живыеФайлы(repoRoot, srcRoot = join(repoRoot, 'frontend/src')) {
  const frontend = dirname(srcRoot);
  return [...файлы(frontend), ...файлы(join(repoRoot, 'backend'))]
    .filter(full => !['scripts/no-accent-drift.mjs', 'scripts/accent-trace.json'].includes(relative(frontend, full)))
    .map(full => ({
      путь: full.startsWith(frontend + '/') ? 'frontend/' + relative(frontend, full) : relative(repoRoot, full),
      текст: readFileSync(full, 'utf8'),
    }));
}

export function снятьСлед(files) {
  return Object.fromEntries(files.map(f => [f.путь, след(f.текст)])
    .filter(([, names]) => names.length).sort(([a], [b]) => a.localeCompare(b)));
}

export function проверитьОбъявленияАкцента(css, прочиеСтили = [], значения) {
  const беды = [];
  const [start, end] = МАРКЕРЫ;
  const a = css.indexOf(start), b = css.indexOf(end);
  if (css.split(start).length !== 2 || css.split(end).length !== 2 || a >= b) {
    беды.push('index.css: нужна ровно одна упорядоченная пара маркеров семейства ролей');
  }
  const чистый = stripComments(css);
  const re = /--(?:color-)?(accent(?:-[\w-]+)?)\s*:\s*([^;{}]+);/g;
  const seen = new Map();
  for (const m of чистый.matchAll(re)) {
    const name = m[1];
    if (seen.has(name)) беды.push(`index.css: повторное объявление ${name}`);
    seen.set(name, m[2].trim());
    if (!ДОПУСТИМЫЕ.has(name)) беды.push(`index.css: второе семейство/неизвестная роль ${name}`);
    if (m.index < a + start.length || m.index > b) беды.push(`index.css: ${name} объявлен вне единственного блока ролей`);
  }
  for (const name of РОЛИ) {
    if (!seen.has(name)) беды.push(`index.css: пропало объявление ${name}`);
    else if (seen.get(name) !== значения[name]) беды.push(`index.css: ${name} изменился (${seen.get(name)} вместо ${значения[name]}); требуется решение о смене палитры и замер`);
  }
  for (const { путь, текст } of прочиеСтили) {
    for (const m of stripComments(текст).matchAll(re)) беды.push(`${путь}: ${m[1]} объявлен вне index.css`);
  }
  // Алиас под другим именем тоже создаёт второй вход к акценту.
  for (const { путь, текст } of [{ путь: 'frontend/src/index.css', текст: css }, ...прочиеСтили]) {
    for (const m of stripComments(текст).matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
      if (!m[1].startsWith('--color-accent') && /var\(\s*--(?:color-)?accent(?:-[\w-]+)?\b/.test(m[2])) {
        беды.push(`${путь}: второй вход к акценту через ${m[1]}`);
      }
    }
  }
  return беды;
}

export function проверить(files, snapshot) {
  const беды = [];
  const values = snapshot.значения || {};
  if (Object.keys(values).length !== РОЛИ.length || РОЛИ.some(n => !Object.hasOwn(values, n))) {
    беды.push('снимок: словарь должен содержать только единственное семейство ролей');
  }
  if (!snapshot.основание?.решение || !snapshot.основание?.проверка || !snapshot.основание?.исходныйКоммит) {
    беды.push('снимок: отсутствует основание (решение, исходныйКоммит, проверка)');
  }
  const index = files.find(f => f.путь === 'frontend/src/index.css');
  if (!index) беды.push('frontend/src/index.css: источник палитры исчез');
  else беды.push(...проверитьОбъявленияАкцента(index.текст, files.filter(f => f !== index), values));
  const current = снятьСлед(files);
  for (const f of files) {
    const names = след(f.текст);
    for (const name of new Set(names)) if (!ДОПУСТИМЫЕ.has(name)) беды.push(`${f.путь}: запрещённое акцентное имя ${name}`);
  }
  for (const name of new Set([...Object.keys(snapshot.след || {}), ...Object.keys(current)])) {
    const was = snapshot.след?.[name] || [], now = current[name] || [];
    if (was.join(' ') !== now.join(' ')) беды.push(`${name}: назначение ролей изменилось (было ${was.length}, стало ${now.length}); сначала вычисленные цвета/разбор переноса, затем снимок`);
  }
  return { беды, мест: Object.values(current).reduce((n, x) => n + x.length, 0) };
}

/** Настоящие файлы во временном дереве; все образцы работают при КАЖДОМ запуске. */
export function самопроверка() {
  const box = mkdtempSync(join(tmpdir(), 'chip-accent-'));
  let checks = 0;
  try {
    const put = (name, text) => { const full = join(box, name); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, text); };
    const values = Object.fromEntries(РОЛИ.map(n => [n, n === 'accent-subtle' ? '#FCF2EB' : '#B45309']));
    const css = `@theme static {\n${МАРКЕРЫ[0]}\n${РОЛИ.map(n => `--color-${n}: ${values[n]};`).join('\n')}\n${МАРКЕРЫ[1]}\n}`;
    const original = '<b className="bg-accent text-accent-solid" />';
    put('frontend/src/index.css', css); put('frontend/src/A.tsx', original);
    const snapshot = { значения: values, след: снятьСлед(живыеФайлы(box)), основание: { решение: 'fixture', исходныйКоммит: 'fixture', проверка: 'fixture' } };
    const check = (dirty, label) => {
      const result = проверить(живыеФайлы(box), snapshot);
      assert.equal(result.беды.length > 0, dirty, `${label}: ${result.беды.join('; ')}`); checks++;
    };
    check(false, 'чистое дерево');
    put('frontend/src/A.tsx', '<b className="bg-accent-subtle text-accent-solid" />');
    check(true, 'подмена роли другим значением');
    put('frontend/src/A.tsx', '<b className="bg-accent-solid text-accent-solid" />');
    check(true, 'подмена роли при том же hex');
    put('frontend/src/A.tsx', original); check(false, 'роль восстановлена');
    // Объявление второго семейства нельзя узаконить даже испорченным снимком.
    for (const where of ['frontend/src/index.css', 'frontend/src/rogue.css', 'frontend/public/rogue.svg', 'backend/src/template.ts', 'frontend/vite.config.ts']) {
      const extra = '--color-accent-v4-500: #B45309;';
      put(where, where.endsWith('index.css') ? css.replace(МАРКЕРЫ[1], extra + МАРКЕРЫ[1]) : `<style>:root {${extra}}</style>`);
      check(true, `второе семейство в ${where}`);
      if (where.endsWith('index.css')) put(where, css); else rmSync(join(box, where));
      check(false, `восстановлен ${where}`);
    }
    put('frontend/src/A.tsx', '<i className="bg-accent-v3-500"/>');
    check(true, 'возврат легаси-ссылки');
    const forged = { ...snapshot, значения: {...values, 'accent-v3-500':'#B45309'}, след:снятьСлед(живыеФайлы(box)) };
    assert.ok(проверить(живыеФайлы(box), forged).беды.length, 'пересъёмка узаконила второе семейство'); checks++;
    put('frontend/src/A.tsx', original);
    put('frontend/src/index.css', css.replace('--color-accent: #B45309;', '--color-accent: #123456;'));
    check(true, 'смена значения');
    put('frontend/src/index.css', css.replace('--color-accent: #B45309;', ''));
    check(true, 'потеря объявления');
    put('frontend/src/index.css', css + '\n:root {--color-accent: #B45309;}');
    check(true, 'дубликат роли');
    put('frontend/src/index.css', css + '\n:root {--color-brand: var(--color-accent);}');
    check(true, 'алиас под другим именем');
    put('frontend/src/index.css', css); check(false, 'всё восстановлено');
    assert.deepEqual(след('group-hover:bg-accent/20 ring-(--color-accent-ring) var(--color-accent-pressed, red) // bg-accent-v3-500'), ['accent','accent-ring','accent-pressed']); checks++;
    assert.deepEqual(след('<p class="accent-line">local selector</p>'), []); checks++;
    const fixtureEntry = join(box, 'frontend/src/A.tsx');
    const aliasEntry = join(box, 'entry-alias.tsx');
    symlinkSync(fixtureEntry, aliasEntry);
    assert.equal(прямойЗапуск(aliasEntry, pathToFileURL(fixtureEntry)), true); checks++;
    assert.equal(прямойЗапуск(fixtureEntry, import.meta.url), false); checks++;
    assert.equal(прямойЗапуск(undefined, import.meta.url), false); checks++;
    return checks;
  } finally { rmSync(box, { recursive: true, force: true }); }
}

if (прямойЗапуск(process.argv[1], import.meta.url)) {
  try {
    const count = самопроверка();
    console.log(`✓ no-accent-drift: ${count} самопроверки сломом и восстановлением`);
    const argv = process.argv.slice(2);
    if (argv.includes('--refresh') || argv.includes('--обновить')) throw Error('Автоматической пересъёмки нет: сначала решение/разбор и вычисленные цвета, затем обоснованный снимок.');
    if (!argv.includes('--selftest') && !argv.includes('--самопроверка')) {
      const src = argv.find(a => !a.startsWith('--'));
      const snapshot = JSON.parse(readFileSync(SNAP, 'utf8'));
      const srcRoot = src ? resolve(src) : join(HERE, '../src');
      // Docker COPY frontend/. /app не содержит backend. В монорепозитории
      // исчезновение backend остаётся ошибкой следа; в отдельной frontend-
      // сборке проверяем только реально включённую в неё поверхность.
      const isolatedFrontend = !existsSync(join(REPO, 'frontend/package.json')) && existsSync(join(dirname(srcRoot), 'package.json'));
      const baseline = isolatedFrontend ? { ...snapshot, след: Object.fromEntries(Object.entries(snapshot.след).filter(([p]) => p.startsWith('frontend/'))) } : snapshot;
      const { беды, мест } = проверить(живыеФайлы(REPO, srcRoot), baseline);
      if (беды.length) throw Error(`${беды.length} нарушений:\n${беды.map(b => '  ' + b).join('\n')}`);
      console.log(`✓ no-accent-drift: единственное семейство (${РОЛИ.length} ролей), значения и назначения подтверждены (${мест} обращений)`);
    }
  } catch (error) { console.error(`✗ no-accent-drift: ${error.message}`); process.exitCode = 1; }
}
