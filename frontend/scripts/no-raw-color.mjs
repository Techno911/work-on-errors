#!/usr/bin/env node
/** Colors in UI code use roles. The user-owned tag palette is data, not a
 * theme: owner decision 2026-09-09, also recorded in no-accent-drift.mjs.
 * Only its literal const array in TagManager is exempt, never the whole file.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments, args } from './gate-shared.mjs';
import { parse, traverse, ts, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const FOREIGN = 'violet|purple|indigo|teal|emerald|sky|slate|gray|zinc|' +
  'neutral|rose|pink|fuchsia|cyan|lime|' +
  'stone|orange|red|green|amber|blue|yellow';
const PREFIX = 'bg|text|border|ring|from|to|via|fill|stroke|outline|' +
  'decoration|divide|placeholder|accent|shadow|caret';

const RE_HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const RE_RGBA = /\brgba?\(\s*\d[^)]*\)/g;
/* Склейка цвета с двузначным хвостом прозрачности: barColor + '22'. Приём
   работает только с hex и молча ломается на роли: var(--color-x)22 это не
   цвет, и подложка исчезает без единой ошибки сборки. Поймано кадрами
   07.09.2026 на плашке нормы в ProgressIndicator. */
const RE_ALPHA_CONCAT =
  /[A-Za-z_$][\w$]*(?:[Cc]olor|[Aa]ccent|[Bb]g|[Ff]ill|[Ss]troke)\s*\+\s*['"][0-9A-Fa-f]{2}['"]/g;

const RE_FOREIGN = new RegExp(
  `(?<![\\w-])(?:(?:[a-z-]+):)*(?:${PREFIX})-(?:${FOREIGN})-\\d{2,3}(?![\\w-])`, 'g');

function find(line) {
  const out = [];
  for (const m of line.matchAll(RE_HEX)) out.push(`литерал цвета ${m[0]}`);
  for (const m of line.matchAll(RE_RGBA)) out.push(`литерал цвета ${m[0].replace(/\s+/g, '')}`);
  for (const m of line.matchAll(RE_FOREIGN)) out.push(`палитра вместо роли ${m[0]}`);
  for (const m of line.matchAll(RE_ALPHA_CONCAT))
    out.push(`прозрачность склейкой ${m[0]} — роль так не склеить, нужен color-mix`);
  return out;
}

export function scanSource(source, filename) {
  const parsed = parse(source, filename);
  if (parsed.sf.parseDiagnostics.length) throw Error(`Не разобран исходник ${filename}`);
  const blanks = [];
  if (filename === 'components/analytics/TagManager.tsx') {
    traverse(parsed.sf, node => {
      if (!ts.isVariableDeclaration(node) || node.name.getText() !== 'PRESET_COLORS'
        || !(node.parent.flags & ts.NodeFlags.Const)
        || !ts.isVariableStatement(node.parent.parent)
        || node.parent.parent.parent !== parsed.sf
        || !node.initializer || !ts.isArrayLiteralExpression(node.initializer)
        || !node.initializer.elements.length
        || !node.initializer.elements.every(e => ts.isStringLiteral(e) && /^#[0-9a-f]{6}$/i.test(e.text))) return;
      blanks.push([node.initializer.getStart(parsed.sf), node.initializer.end]);
    });
  }
  let code = stripComments(source);
  for (const [start, end] of blanks.sort((a,b) => b[0]-a[0])) {
    code = code.slice(0,start) + code.slice(start,end).replace(/[^\n]/g, ' ') + code.slice(end);
  }
  return code.split('\n').flatMap((line, i) => find(line).map(detail => ({line:i+1,kind:'raw-color',detail})));
}
export function selftest() {
  return assertSamples('no-raw-color', scanSource, [
    {label:'литерал',source:'const C = <p style={{color:"#123456"}}/>;',expected:1},
    {label:'палитра',source:'const C = <p className="text-violet-500"/>;',expected:1},
    {label:'rgb',source:'const C = <p style={{color:"rgb(255,0,0)"}}/>;',expected:1},
    {label:'склейка',source:'const bg = barColor + "22";',expected:1},
    {label:'роль и комментарий',source:'// #123456\nconst C = <p className="text-fg"/>;',expected:0},
    {label:'пользовательские данные',filename:'components/analytics/TagManager.tsx',source:'const PRESET_COLORS = ["#EF4444", "#8B5CF6"];',expected:0},
    {label:'тот же файл не исключён',filename:'components/analytics/TagManager.tsx',source:'const PRESET_COLORS = ["#EF4444"]; const C = <p style={{color:"#123456"}}/>;',expected:1},
    {label:'имя в другом файле',source:'const PRESET_COLORS = ["#EF4444"];',expected:1},
    {label:'произвольный объект не палитра',filename:'components/analytics/TagManager.tsx',source:'const PRESET_COLORS = { color: "#123456" };',expected:1},
  ]);
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { refresh, selftest: onlyTest, srcArg } = args();
    if (refresh) throw Error('Снимка долга нет: используйте роль, а пользовательские данные проверяйте по контракту');
    console.log(`✓ no-raw-color: ${selftest()} самопроверок`);
    if (!onlyTest) process.exitCode = report('no-raw-color', inspectTree(srcArg || join(HERE,'..','src'), scanSource));
  } catch (error) { console.error(`✗ no-raw-color: ${error.message}`); process.exitCode = 1; }
}
