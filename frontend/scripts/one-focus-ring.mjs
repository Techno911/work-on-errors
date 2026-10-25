#!/usr/bin/env node
/** Focus uses the single :focus-visible outline in index.css.
 * Permanent rings denote selection, validation or anchor highlighting; they
 * are not focus indicators. No debt snapshot and no file-level exemptions.
 *
 * 14.09.2026: checkGlobal раньше проверял только форму обводки (одна, 2px,
 * offset 2px) и останавливался — контраст роли против фона не мерил вообще.
 * Ровно это не поймало, что accent-pressed (#773706) даёт 1,93:1 на тёмной
 * панели Sidebar при пороге WCAG 1.4.11 ≥3:1 (та же дыра, что нашлась на
 * Бренд-платформе на кольце фокуса). checkRingContrast меряет фактическую
 * роль обводки против каждой поверхности из index.css и печатает все пары.
 */
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { args, stripComments, packageThemeCss } from './gate-shared.mjs';
import { parse, traverse, ts, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';
import { readRoles, rgba } from './no-white-on-fill.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
export const MIN_NONTEXT_CONTRAST = 3.0;
/* Поверхности, на которых реально стоят фокусируемые элементы (Sidebar,
   карточки, поля, тёмные подсказки) — не «все роли подряд», а перечень,
   подтверждённый обходом src (surface-inverse держит NavLink панели). */
export const SURFACE_ROLES = [
  'canvas', 'surface-sunken', 'surface',
  'inverse', 'inverse-hover',
];
function linear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}
function relativeLuminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
export function contrastBetween(colorA, colorB) {
  const [l1, l2] = [relativeLuminance(colorA), relativeLuminance(colorB)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** Роль обводки → контраст против каждой поверхности. Не тормозит на первом
 * провале: печатает все пары, чтобы был виден весь охват, а не одна цифра. */
export function checkRingContrast(css) {
  const outline = /outline:\s*2px solid var\(--color-([\w-]+)\)\s*;/.exec(stripComments(css));
  if (!outline) throw Error('Роль обводки :focus-visible не найдена — нечего мерить');
  const roles = readRoles(css);
  const ring = rgba(`var(--color-${outline[1]})`, roles);
  const pairs = SURFACE_ROLES.map((surface) => {
    if (!roles.has(surface)) throw Error(`Роль --color-${surface} не найдена в index.css`);
    const bg = rgba(roles.get(surface), roles);
    const ratio = contrastBetween(ring.slice(0, 3), bg.slice(0, 3));
    return { role: outline[1], surface, ratio };
  });
  const failed = pairs.filter((p) => p.ratio < MIN_NONTEXT_CONTRAST);
  return { pairs, failed };
}
export function scanSource(source, filename) {
  const parsed = parse(source, filename), hits = [];
  traverse(parsed.sf, node => {
    if (!ts.isStringLiteralLike(node) && !ts.isTemplateHead(node) && !ts.isTemplateMiddle(node) && !ts.isTemplateTail(node)) return;
    for (const token of node.text.split(/\s+/)) {
      if (!/(?:^|:|&)(?:(?:group|peer)-)?focus(?:-visible|-within)?(?=:|\])/.test(token)) continue;
      if (/(?:^|:)!?ring(?:-|$)/.test(token) || /(?:^|:)!?outline-(?:none|hidden)!?$/.test(token)) {
        hits.push({ line: parsed.line(node), kind: 'local-focus', detail: token });
      }
    }
  });
  return hits;
}
export function checkGlobal(css) {
  const blocks = [...stripComments(css).matchAll(/(?:^|(?<=\}))\s*:focus-visible\s*\{([^}]+)\}/g)];
  if (blocks.length !== 1 || !/outline:\s*2px solid var\(--color-[\w-]+\)\s*;/.test(blocks[0][1])
    || !/outline-offset:\s*2px\s*;/.test(blocks[0][1])) throw Error('В index.css нужна единственная общая обводка :focus-visible (2px, offset 2px)');
}
export function selftest() {
  const cases = [
    { label: 'своё кольцо', source: '<input className="focus:ring-accent-ring"/>', expected: 1 },
    { label: 'вариант focus-visible', source: '<input className="focus-visible:ring-stone-400"/>', expected: 1 },
    { label: 'группа', source: '<input className="group-focus:focus-visible:ring-[#123456]"/>', expected: 1 },
    { label: 'фокус группы', source: '<input className="group-focus:ring-(--color-accent)"/>', expected: 1 },
    { label: 'фокус соседа', source: '<input className="peer-focus-visible:ring-2"/>', expected: 1 },
    { label: 'произвольный селектор', source: '<input className="[&:focus-visible]:ring-2"/>', expected: 1 },
    { label: 'произвольный модификатор', source: '<input className="data-[active=true]:focus-visible:ring-(--color-accent)"/>', expected: 1 },
    { label: 'второе кольцо без цвета', source: '<input className="focus:ring-2"/>', expected: 1 },
    { label: 'подавленная обводка', source: '<input className="focus:outline-none"/>', expected: 1 },
    { label: 'шаблон', source: '<input className={`focus:ring-accent ${error ? "border-danger" : "border-border"}`}/>', expected: 1 },
    { label: 'выбор', source: '<button className={chosen ? "ring-1 ring-accent" : "border-border"}/>', expected: 0 },
    { label: 'ошибка и подсветка секции', source: '<div className="ring-2 ring-danger-muted ring-offset-2"/>', expected: 0 },
    { label: 'комментарий', source: '// focus:ring-accent\nconst C = <input className="border-border"/>;', expected: 0 },
    { label: 'сам компонент поля не исключён', filename: 'components/ui/input.tsx', source: '<input className="focus-visible:ring-[#123456]"/>', expected: 1 },
  ];
  const css = ':focus-visible { outline: 2px solid var(--color-accent-pressed); outline-offset: 2px; }';
  checkGlobal(css);
  assert.throws(() => checkGlobal(''));
  assert.throws(() => checkGlobal(css + css));
  assert.throws(() => checkGlobal(css.replace('outline: 2px', 'outline: 0px')));

  /* Слом в обе стороны: слабое значение обязано покраснеть на тёмной
     поверхности, восстановленное — замолчать. Пять ролей поверхностей
     обязаны присутствовать и участвовать в проверке, иначе замок слеп.
     Имена фикстур («ring-weak»/«ring-strong») намеренно не содержат
     «accent», чтобы самопроверка не создавала второй, тестовый вход в
     семейство акцента, за которым следит no-accent-drift.mjs. */
  const rolesCss = `:root {
    --color-canvas: #FAFAF9; --color-surface-sunken: #F5F5F4;
    --color-surface: #FFFFFF; --color-inverse: #1A1A1A;
    --color-inverse-hover: #242424; --color-ring-strong: #D16310;
    --color-ring-weak: #773706;
  }`;
  const weak = checkRingContrast(rolesCss + ':focus-visible { outline: 2px solid var(--color-ring-weak); outline-offset: 2px; }');
  if (weak.failed.length === 0) throw Error('слепота: не поймал слабое кольцо (1,93:1) на тёмной панели');
  if (!weak.failed.some((p) => p.surface === 'inverse')) throw Error('слепота: провал не привязан к surface-inverse');
  const strong = checkRingContrast(rolesCss + ':focus-visible { outline: 2px solid var(--color-ring-strong); outline-offset: 2px; }');
  if (strong.failed.length !== 0) throw Error('слепота: восстановленное кольцо обязано молчать на всех пяти поверхностях');
  if (strong.pairs.length !== SURFACE_ROLES.length) throw Error('слепота: не все поверхности участвуют в проверке');
  assert.throws(() => checkRingContrast(rolesCss.replace('--color-inverse: #1A1A1A;', '')
    + ':focus-visible { outline: 2px solid var(--color-ring-strong); outline-offset: 2px; }'), 'исчезнувшая поверхность обязана падать, а не молчать');

  return assertSamples('one-focus-ring', scanSource, cases) + 9;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { refresh, selftest: onlyTest, srcArg } = args();
    if (refresh) throw Error('Допуска долга нет: используйте общую обводку');
    console.log(`✓ one-focus-ring: ${selftest()} самопроверок`);
    if (!onlyTest) {
      const root = srcArg || join(HERE, '..', 'src');
      // Правило :focus-visible живёт в index.css платформы, роли цвета —
      // в словаре пакета: обе половины нужны вместе (packageThemeCss()).
      const localCss = readFileSync(join(root, 'index.css'), 'utf8');
      checkGlobal(localCss);
      const css = packageThemeCss() + '\n' + localCss;
      const { pairs, failed } = checkRingContrast(css);
      for (const p of pairs) {
        console.log(`  · ${p.role} на ${p.surface} = ${p.ratio.toFixed(2)}:1 ` +
          `${p.ratio < MIN_NONTEXT_CONTRAST ? '✗' : '✓'} (норма ${MIN_NONTEXT_CONTRAST})`);
      }
      if (failed.length) {
        console.error(`✗ one-focus-ring: контраст обводки ниже 3:1 на ${failed.length} поверхностях`);
        process.exitCode = 1;
      } else {
        process.exitCode = report('one-focus-ring', inspectTree(root, scanSource));
      }
    }
  } catch (error) { console.error(`✗ one-focus-ring: ${error.message}`); process.exitCode = 1; }
}
