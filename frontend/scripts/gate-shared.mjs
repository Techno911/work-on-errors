/**
 * Общая механика замков дизайн-системы «Работа над ошибками».
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ФАЙЛ. Четыре замка делают одно и то же: обходят дерево,
 * вырезают комментарии, считают нарушения по файлам, сверяют со снимком долга
 * и печатают адреса. Копия этой механики в каждом замке разошлась бы на первой
 * же правке, поэтому она живёт здесь одна.
 *
 * КАК УСТРОЕН СНИМОК ДОЛГА И ПОЧЕМУ ОН НЕ ДЕЛАЕТ ДЕФЕКТ НОРМОЙ.
 * Код платформы сегодня нарушает все четыре правила: 430 литералов цвета,
 * 325 сырых кнопок, 114 карточек руками, 84 кольца фокуса. Замок, падающий на
 * этом, невозможно поставить в сборку: он заблокирует не ошибку, а работу.
 * Поэтому замок держит снимок долга по файлам и падает в двух случаях:
 *   1) в файле стало больше нарушений, чем было в снимке;
 *   2) появился файл, которого в снимке нет.
 * Долг может только уменьшаться. Когда он уменьшился, замок это замечает и
 * говорит, что снимок пора обновить (`--refresh`), иначе снимок начинает
 * прикрывать вернувшиеся нарушения. Когда долг дошёл до нуля, снимок удаляется
 * и замок становится обычным запретом.
 *
 * САМОПРОВЕРКА. У каждого замка есть режим `--selftest`: он собирает во
 * временной папке заведомо грязный и заведомо чистый файл и требует, чтобы
 * находка нашлась на первом и НЕ нашлась на втором. Обе половины обязательны:
 * замок без первой слеп, замок без второй блокирует здоровый код и приучает
 * себя обходить.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync,
         mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

/**
 * Словарь ролей цвета живёт в @chirkov/shell с 23.09.2026, а не в index.css
 * платформы (переезд на пакет 0.3.0). `--color-X` в theme.css — алиас на
 * `--chip-color-X` из tokens.css, который сам иногда ссылается на ещё один
 * примитив (`--chip-color-amber-base`) — оба файла нужны вместе, чтобы цепочку
 * можно было развернуть до литерала.
 */
export function packageThemeCss() {
  const require = createRequire(import.meta.url);
  const themePath = require.resolve('@chirkov/shell/theme.css');
  const tokensPath = join(dirname(themePath), 'tokens.css');
  return readFileSync(tokensPath, 'utf8') + '\n' + readFileSync(themePath, 'utf8');
}

/** Обход дерева. Возвращает пути с расширениями из списка. */
export function walk(root, exts = ['.tsx', '.jsx', '.ts']) {
  const out = [];
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(full).isDirectory()) { out.push(...walk(full, exts)); continue; }
    if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out.sort();
}

/**
 * Вырезание комментариев. Без него замок ловит собственное объяснение:
 * строка «// не пиши bg-[#FF6900]» это документация, а не нарушение.
 * Блочные комментарии затираются пробелами (номера строк сохраняются),
 * строчные вырезаются только там, где двум косым не предшествует двоеточие:
 * иначе из `https://…` вырезается половина адреса.
 */
export function stripComments(text) {
  let out = '', mode = 'code', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (mode === 'code' && c === '/' && n === '*') { mode = 'block'; out += '  '; i++; continue; }
    if (mode === 'code' && c === '/' && n === '/') { mode = 'line'; out += '  '; i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; out += '  '; i++; } else out += c === '\n' ? '\n' : ' '; continue; }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } else out += ' '; continue; }
    out += c;
    if ((mode === 'code') && (c === "'" || c === '"' || c === '`')) { mode = c; escaped = false; }
    else if (mode !== 'code') { if (c === mode && !escaped) mode = 'code'; escaped = c === '\\' && !escaped; }
  }
  return out;
}

/** Считает нарушения по файлам. `find` возвращает массив попаданий в строке. */
export function collect({ root, skip = [], find }) {
  const perFile = {};
  const hits = [];
  for (const full of walk(root)) {
    const rel = 'src' + full.slice(root.length);
    if (skip.some((s) => rel === s || rel.endsWith('/' + s))) continue;
    const lines = stripComments(readFileSync(full, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      for (const hit of find(line)) {
        perFile[rel] = (perFile[rel] || 0) + 1;
        hits.push(`${rel}:${i + 1}  ${hit}`);
      }
    });
  }
  return { perFile, hits, total: hits.length };
}

function readBaseline(path) {
  if (!existsSync(path)) return { debt: {} };
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { debt: {} }; }
}

/**
 * Сверка со снимком долга и вердикт. Возвращает код выхода.
 * Печатает по-русски: замок читает человек, а не только машина.
 */
export function verdict({ name, rule, cure, baselinePath, perFile, hits, refresh }) {
  const snapshot = readBaseline(baselinePath);
  const debt = snapshot.debt || {};
  const total = Object.values(perFile).reduce((s, n) => s + n, 0);

  if (refresh) {
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, JSON.stringify({
      gate: name,
      rule,
      taken: new Date().toISOString().slice(0, 10),
      total,
      debt: Object.fromEntries(Object.entries(perFile).sort()),
    }, null, 1) + '\n', 'utf8');
    console.log(`✓ ${name}: снимок долга обновлён, ${total} мест в ` +
      `${Object.keys(perFile).length} файлах`);
    return 0;
  }

  const grown = [];
  for (const [file, count] of Object.entries(perFile)) {
    const was = debt[file] || 0;
    if (count > was) grown.push({ file, was, now: count });
  }

  if (grown.length) {
    console.error(`\n✗ ${name}: ${rule}`);
    console.error('  Стало больше, чем в снимке долга:');
    for (const g of grown) {
      console.error(`    ${g.file}: было ${g.was}, стало ${g.now}`);
      const own = hits.filter((h) => h.startsWith(g.file + ':'));
      for (const h of own.slice(-(g.now - g.was))) console.error(`      ${h}`);
    }
    console.error(`\n  ${cure}\n`);
    console.error('  Долг платформы может только уменьшаться. Если нарушение ' +
      'неизбежно, это решение владельца, а не обход замка: снимите долг ' +
      `командой «node ${basename(baselinePath).replace('.baseline.json', '.mjs')} ` +
      '--refresh» и назовите причину в сообщении коммита.\n');
    return 1;
  }

  const wasTotal = Object.values(debt).reduce((s, n) => s + n, 0);
  if (!total) {
    console.log(`✓ ${name}: нарушений нет вовсе. Снимок долга можно удалить, ` +
      'и замок станет обычным запретом.');
    return 0;
  }
  if (Object.keys(debt).length && total < wasTotal) {
    console.log(`✓ ${name}: новых нарушений нет. Долг уменьшился: ` +
      `${wasTotal} → ${total}. Обновите снимок ключом --refresh.`);
    return 0;
  }
  console.log(`✓ ${name}: новых нарушений нет (в долге ${total} мест)`);
  return 0;
}

/**
 * Самопроверка сломом. `dirty` обязан дать находку, `clean` обязан не дать.
 */
export function selftest({ name, find, dirty, clean, skip = [] }) {
  const box = mkdtempSync(join(tmpdir(), 'chip-gate-'));
  let failed = 0;
  try {
    mkdirSync(join(box, 'components'), { recursive: true });
    writeFileSync(join(box, 'components', 'Dirty.tsx'), dirty, 'utf8');
    writeFileSync(join(box, 'components', 'Clean.tsx'), clean, 'utf8');
    const { perFile, hits } = collect({ root: box, skip, find });
    const onDirty = perFile['src/components/Dirty.tsx'] || 0;
    const onClean = perFile['src/components/Clean.tsx'] || 0;
    if (onDirty < 1) {
      console.error(`✗ ${name}: слом не пойман, замок слеп`);
      failed++;
    } else {
      const first = hits.find((h) => h.includes('Dirty')) || '';
      const word = onDirty % 10 === 1 && onDirty % 100 !== 11 ? 'находка'
        : [2, 3, 4].includes(onDirty % 10) && ![12, 13, 14].includes(onDirty % 100)
          ? 'находки' : 'находок';
      console.log(`✓ ${name}: слом пойман (${onDirty} ${word}) — ${first.trim()}`);
    }
    if (onClean > 0) {
      console.error(`✗ ${name}: ложное срабатывание на чистом коде — ` +
        hits.filter((h) => h.includes('Clean')).join('; '));
      failed++;
    } else {
      console.log(`✓ ${name}: на чистом коде молчит`);
    }
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

/** Разбор ключей командной строки, одинаковый у всех замков. */
export function args() {
  const a = process.argv.slice(2);
  return {
    refresh: a.includes('--refresh') || a.includes('--обновить'),
    selftest: a.includes('--selftest') || a.includes('--самопроверка'),
    srcArg: a.find((x) => !x.startsWith('--')) || null,
  };
}
