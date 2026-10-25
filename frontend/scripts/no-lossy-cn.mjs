#!/usr/bin/env node
/**
 * ЗАМОК: cn() не имеет права удалять классы разных CSS-свойств.
 *
 * Tailwind v4 создаёт наши ролевые классы из CSS-темы, а tailwind-merge 2.x
 * эту тему сам не читает. Поэтому дефолтный merger считает, например,
 * `text-caption` и `text-fg-muted` двумя цветами и молча удаляет один из них.
 * Проверка перебирает статически достижимые строки во всех вызовах cn().
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { twMerge as defaultTwMerge } from 'tailwind-merge';
import { designRoles, twMerge as appCn } from '../src/lib/tailwind-merge-config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'src');
const LIMIT = 256;
const fontSizes = new Set(designRoles.fontSize);
const colors = new Set(designRoles.color);
const radii = new Set(designRoles.radius);
const shadows = new Set(designRoles.shadow);

function unique(values) {
  return [...new Set(values)].slice(0, LIMIT);
}

function combine(left, right) {
  const out = [];
  for (const a of left) {
    for (const b of right) {
      out.push(`${a} ${b}`.trim());
      if (out.length >= LIMIT) return unique(out);
    }
  }
  return unique(out);
}

function scenarios(node) {
  if (!node) return [''];
  if (ts.isStringLiteralLike(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)
      || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)
      || ts.isSatisfiesExpression?.(node)) return scenarios(node.expression);
  if (ts.isTemplateExpression(node)) {
    let out = [node.head.text];
    for (const span of node.templateSpans) {
      out = combine(out, scenarios(span.expression));
      out = out.map((value) => `${value}${span.literal.text}`);
    }
    return unique(out);
  }
  if (ts.isConditionalExpression(node)) {
    return unique([...scenarios(node.whenTrue), ...scenarios(node.whenFalse)]);
  }
  if (ts.isBinaryExpression(node)) {
    if (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return unique(['', ...scenarios(node.right)]);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken
        || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
      return unique([...scenarios(node.left), ...scenarios(node.right)]);
    }
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return combine(scenarios(node.left), scenarios(node.right));
    }
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.reduce((out, item) => combine(out, scenarios(item)), ['']);
  }
  if (ts.isObjectLiteralExpression(node)) {
    const keys = node.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return [];
      const name = property.name;
      return ts.isStringLiteralLike(name) || ts.isIdentifier(name) ? [name.text] : [];
    });
    return keys.length ? ['', keys.join(' '), ...keys] : [''];
  }
  return [''];
}

function splitModifier(token) {
  const parts = token.split(':');
  return { modifier: parts.slice(0, -1).join(':'), base: parts.at(-1)?.replace(/^!/, '') ?? '' };
}

function propertyOf(base) {
  let match = base.match(/^text-(.+)$/);
  if (match && fontSizes.has(match[1])) return 'font-size';
  if (match && colors.has(match[1])) return 'text-color';

  match = base.match(/^rounded(?:-[trblesxy]{1,2})?-(.+)$/);
  if (match && radii.has(match[1])) return 'border-radius';

  match = base.match(/^border(?:-[xytrblse])?-(.+)$/);
  if (match && colors.has(match[1])) return 'border-color';
  if (/^border(?:-[xytrblse])?(?:-\d+)?$/.test(base)) return 'border-width';

  match = base.match(/^ring-(.+)$/);
  if (match && colors.has(match[1])) return 'ring-color';
  if (/^ring(?:-\d+)?$/.test(base)) return 'ring-width';

  match = base.match(/^outline-(.+)$/);
  if (match && colors.has(match[1])) return 'outline-color';
  if (/^outline(?:-\d+)?$/.test(base)) return 'outline-width';

  match = base.match(/^stroke-(.+)$/);
  if (match && colors.has(match[1])) return 'stroke-color';
  if (/^stroke-\d+$/.test(base)) return 'stroke-width';

  match = base.match(/^shadow-(.+)$/);
  if (match && shadows.has(match[1])) return 'box-shadow';
  return null;
}

function losses(input, merge) {
  const inputGroups = new Map();
  const outputGroups = new Map();
  for (const [target, value] of [[inputGroups, input], [outputGroups, merge(input)]]) {
    for (const token of value.trim().split(/\s+/).filter(Boolean)) {
      const { modifier, base } = splitModifier(token);
      const property = propertyOf(base);
      if (!property) continue;
      const key = `${modifier}|${property}`;
      if (!target.has(key)) target.set(key, []);
      target.get(key).push(token);
    }
  }
  return [...inputGroups.entries()]
    .filter(([key]) => !outputGroups.has(key))
    .map(([key, tokens]) => ({ key, tokens }));
}

function selftest() {
  const broken = [
    'text-micro text-fg-muted',
    'text-fg-muted text-micro',
  ];
  for (const input of broken) {
    if (losses(input, defaultTwMerge).length !== 1) {
      throw new Error(`самопроверка не поймала слом: ${input}`);
    }
    if (losses(input, appCn).length !== 0) {
      throw new Error(`cn() приложения всё ещё ломает: ${input}`);
    }
  }
  const coexist = [
    'border border-border', 'border-border border',
    'ring-2 ring-accent-focus', 'ring-accent-focus ring-2',
    'outline-2 outline-danger', 'outline-danger outline-2',
    'stroke-2 stroke-fg', 'stroke-fg stroke-2',
  ];
  for (const input of coexist) {
    if (appCn(input).split(/\s+/).length !== 2) {
      throw new Error(`разные свойства ошибочно схлопнулись: ${input}`);
    }
  }
  const override = [
    ['rounded-card rounded-block', 'rounded-block'],
    ['rounded-block rounded-card', 'rounded-card'],
    ['shadow-sm shadow-raised', 'shadow-raised'],
    ['shadow-raised shadow-sm', 'shadow-sm'],
  ];
  for (const [input, expected] of override) {
    if (appCn(input) !== expected) {
      throw new Error(`одно свойство не схлопнулось по порядку: ${input}`);
    }
  }
}

/**
 * Раньше карта ролей была второй копией словаря (тут же, руками) и сверялась
 * с index.css — 23.09.2026 копия и файл разошлись при переезде на пакет.
 * Теперь designRoles сам читается из @chirkov/shell/theme.css
 * (src/lib/tailwind-merge-config.js), второго носителя нет: проверка ниже
 * лишь ловит пустой список, если резолюция пакета сломалась молча.
 */
function assertRolesLoaded() {
  for (const [prefix, list] of Object.entries(designRoles)) {
    if (!list.length) {
      throw new Error(`designRoles.${prefix} пуст: словарь @chirkov/shell не прочитался`);
    }
  }
}

selftest();
assertRolesLoaded();

if (process.argv.includes('--selftest')) {
  console.log('✓ no-lossy-cn selftest: дефолт теряет размер в прямом порядке и цвет в обратном; настроенный merger сохраняет разные свойства, схлопывает только одинаковые; карта ролей читается из пакета');
  process.exit(0);
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(target);
  }
}
walk(ROOT);

let callCount = 0;
const configuredLosses = [];
const legacyLosses = [];
for (const filename of files) {
  const source = fs.readFileSync(filename, 'utf8');
  const sourceFile = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'cn') {
      callCount += 1;
      const variants = node.arguments.reduce((out, argument) => combine(out, scenarios(argument)), ['']);
      const current = variants.flatMap((value) => losses(value, appCn));
      const legacy = variants
        .map((value) => ({ value, lost: losses(value, defaultTwMerge) }))
        .filter((result) => result.lost.length > 0);
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      const item = { filename: path.relative(ROOT, filename), line };
      if (current.length) configuredLosses.push({ ...item, losses: current });
      if (legacy.length) {
        const example = legacy[0];
        legacyLosses.push({
          ...item,
          input: example.value,
          defaultOutput: defaultTwMerge(example.value),
          configuredOutput: appCn(example.value),
          lost: example.lost.flatMap((loss) => loss.tokens),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

if (configuredLosses.length) {
  console.error(`✗ no-lossy-cn: ${configuredLosses.length} вызовов cn() теряют другое CSS-свойство`);
  for (const item of configuredLosses) console.error(`  ${item.filename}:${item.line}`);
  process.exit(1);
}

if (process.argv.includes('--report')) {
  for (const item of legacyLosses) {
    console.log(`${item.filename}:${item.line}`);
    console.log(`  было: ${item.input}`);
    console.log(`  дефолт: ${item.defaultOutput}`);
    console.log(`  настроено: ${item.configuredOutput}`);
    console.log(`  терялось: ${item.lost.join(', ')}`);
  }
}

console.log(
  `✓ no-lossy-cn: ${callCount} вызова cn() проверены; `
  + `настроенный merger не теряет разные свойства; дефолтный ломал ${legacyLosses.length} мест`,
);
