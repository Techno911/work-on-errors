#!/usr/bin/env node
/** White text must have contrast >= 4.5 against the actual role in index.css.
 * No accent exception and no debt allowance. JSX branches/cn use the shared
 * AST evaluator; separate recipe literals (e.g. cva) are checked as well.
 * Scope: statically resolved class combinations. Ancestor backgrounds, runtime
 * user colors and cross-component props require rendered checks.
 */
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { args, stripComments, packageThemeCss } from './gate-shared.mjs';
import { parse, traverse, isOpening, attribute, ts, inspectTree, report, assertSamples } from './ui-gate-ast.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
export const MIN_CONTRAST = 4.5;

/**
 * `css` — словарь пакета (tokens.css + theme.css, см. packageThemeCss): роли
 * `--color-X` в theme.css часто алиасят `--chip-color-Y`, а тот иногда ещё
 * один примитив (`--chip-color-amber-base`) — цепочка разворачивается здесь
 * до литерала один раз, дальше вызывающий код читает уже готовый hex/rgba.
 */
export function readRoles(css) {
  const stripped = stripComments(css);
  const raw = new Map();
  const seenColor = new Set();
  for (const m of stripped.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    if (m[1].startsWith('color-')) {
      if (seenColor.has(m[1])) throw Error(`Неоднозначная роль --${m[1]}`);
      seenColor.add(m[1]);
    }
    raw.set(m[1], m[2].trim());
  }
  const resolve = (value, seen) => {
    const alias = /^var\(--([\w-]+)\)$/.exec(value);
    if (!alias) return value;
    if (seen.has(alias[1])) throw Error(`Циклическая ссылка на --${alias[1]}`);
    if (!raw.has(alias[1])) throw Error(`Не найдена переменная --${alias[1]}`);
    return resolve(raw.get(alias[1]), new Set(seen).add(alias[1]));
  };
  const roles = new Map();
  for (const name of seenColor) {
    const bare = name.slice('color-'.length);
    roles.set(bare, resolve(raw.get(name), new Set([name])));
  }
  if (!roles.size) throw Error('Роли цвета не найдены в словаре пакета');
  return roles;
}
export function rgba(value, roles = new Map(), seen = new Set()) {
  const alias = /^var\(--color-([\w-]+)\)$/.exec(value);
  if (alias) {
    if (seen.has(alias[1]) || !roles.has(alias[1])) throw Error(`Не разрешена роль ${value}`);
    return rgba(roles.get(alias[1]), roles, new Set(seen).add(alias[1]));
  }
  if (/^#[\da-f]{3,4}$/i.test(value)) value = '#' + [...value.slice(1)].map(c => c + c).join('');
  if (/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
    const channels = value.slice(1).match(/../g).map(c => parseInt(c, 16) / 255);
    return [...channels.slice(0, 3), channels[3] ?? 1];
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length === 3 || parts.length === 4) {
      const channels = parts.slice(0, 3).map(c => parseFloat(c) / (c.endsWith('%') ? 100 : 255));
      const alpha = parts[3] ? parseFloat(parts[3]) / (parts[3].endsWith('%') ? 100 : 1) : 1;
      if ([...channels, alpha].every(c => Number.isFinite(c) && c >= 0 && c <= 1)) return [...channels, alpha];
    }
  }
  throw Error(`Формат цвета не измерен: ${value}; добавьте преобразование и контрольный образец`);
}
export function contrastOnWhite(color, opacity = 1) {
  const alpha = color[3] * opacity;
  // Conservative white substrate for translucent fills; no invented dark parent.
  const channels = color.slice(0, 3).map(c => c * alpha + 1 - alpha)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 1.05 / (channels.reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0) + 0.05);
}
export function checkClasses(classes, roles) {
  const tokens = classes.trim().split(/\s+/);
  const whites = tokens.filter(t => /^(?:[\w-]+:)*text-(?:on-dark|white)$/.test(t));
  const hits = [];
  for (const token of tokens) {
    const m = /^((?:[\w-]+:)*)(?:!)?bg-([\w-]+)(?:\/(\d+(?:\.\d+)?))?!?$/.exec(token);
    if (!m || !roles.has(m[2]) || m[1].split(':').includes('disabled')) continue;
    const state = m[1];
    const white = whites.some(t => {
      const textState = t.slice(0, t.lastIndexOf('text-'));
      if (textState.split(':').includes('disabled')) return false;
      if (textState === state) return true;
      if (!state) return !tokens.some(other => other.startsWith(textState + 'bg-'));
      return !textState && !tokens.some(other => other.startsWith(state + 'text-')
        && roles.has(other.slice((state + 'text-').length)) && !whites.includes(other));
    });
    if (!white) continue;
    const value = roles.get(m[2]);
    const ratio = contrastOnWhite(rgba(value, roles), m[3] === undefined ? 1 : Number(m[3]) / 100);
    if (ratio < MIN_CONTRAST) hits.push({ kind: 'contrast', detail: `${token}: ${value}, белый ${ratio.toFixed(2)} < 4,50` });
  }
  return hits;
}
export function scanner(roles) {
  return (source, filename) => {
    const parsed = parse(source, filename), hits = [];
    if (parsed.sf.parseDiagnostics.length) throw Error(`Не разобран исходник ${filename}`);
    traverse(parsed.sf, node => {
      if (isOpening(node)) {
        // Inline background wins over normal class utilities. Runtime data is
        // outside this static gate; it is documented in debt-audit.md.
        const style = attribute(node, 'style')?.getText(parsed.sf) ?? '';
        if (/\bbackground(?:Color)?\s*:/.test(style)) return;
        const found = new Map();
        for (const cls of parsed.classes(node).values) {
          // Only the disabled branch of an explicitly disableable control.
          if (attribute(node, 'disabled') && /(?:^|\s)cursor-not-allowed(?:\s|$)/.test(cls)) continue;
          for (const hit of checkClasses(cls, roles)) found.set(hit.detail, hit);
        }
        for (const hit of found.values()) hits.push({ line: parsed.line(node), ...hit });
      } else if (ts.isStringLiteralLike(node)) {
        for (let p = node.parent; p; p = p.parent) if (ts.isJsxAttribute(p)) return;
        for (const hit of checkClasses(node.text, roles)) hits.push({ line: parsed.line(node), ...hit });
      }
    });
    return hits;
  };
}
export function selftest() {
  const roles = readRoles('--color-test: #B45309; --color-pale: #F1AA74; --color-on-dark: #fff; --color-fg: #1A1A1A;');
  const scan = scanner(roles);
  const cases = [
    { label: 'белый на светлом', source: '<button className="bg-pale text-on-dark"/>', expected: 1 },
    { label: 'янтарь, обратный порядок', source: '<button className="text-on-dark bg-test"/>', expected: 0 },
    { label: 'наведение', source: '<button className="bg-test hover:bg-pale text-on-dark"/>', expected: 1 },
    { label: 'смена текста при наведении', source: '<button className="bg-test hover:bg-pale text-on-dark hover:text-fg"/>', expected: 0 },
    { label: 'белый только при наведении', source: '<button className="bg-pale hover:text-white"/>', expected: 1 },
    { label: 'фон меняется вместе с текстом', source: '<button className="bg-pale text-fg hover:bg-test hover:text-white"/>', expected: 0 },
    { label: 'прозрачная заливка', source: '<button className="bg-test/50 text-white"/>', expected: 1 },
    { label: 'многострочный cn', source: 'const C = <button className={cn(\n"text-on-dark",\nactive ? "bg-test" : "bg-pale")}/>;', expected: 1 },
    { label: 'ветки не смешиваются', source: 'const C = <button className={active ? "bg-test text-white" : "bg-pale text-fg"}/>;', expected: 0 },
    { label: 'шаблон', source: 'const C = <button className={`text-white ${active ? "bg-test" : "bg-pale"}`}/>;', expected: 1 },
    { label: 'рецепт cva', source: 'const recipe = { primary: "text-white bg-pale" };', expected: 1 },
    { label: 'комментарии', source: '// bg-pale text-white\nconst C = <p>bg-pale text-white</p>;', expected: 0 },
  ];
  let count = assertSamples('no-white-on-fill', scan, cases);
  assert.equal(contrastOnWhite(rgba('#fff')), 1);
  assert.equal(contrastOnWhite(rgba('#000')), 21);
  assert.ok(Math.abs(contrastOnWhite(rgba('#B45309')) - 5.02163257594) < 1e-9);
  const sample = '<button className="bg-test text-on-dark"/>';
  assert.equal(scan(sample, 'fixture.tsx').length, 0);
  roles.set('test', '#F1AA74');
  assert.equal(scan(sample, 'fixture.tsx').length, 1, 'смена значения той же роли обязана краснеть');
  roles.set('test', '#B45309');
  assert.equal(scan(sample, 'fixture.tsx').length, 0, 'восстановление обязано зеленеть');
  assert.throws(() => rgba('unknown'));
  assert.throws(() => readRoles('--color-x: #fff; --color-x: #000;'));
  const amber = new Map([
    ['accent', '#B45309'], ['accent-solid', '#B45309'], ['accent-strong', '#8F4207'],
    ['accent-pressed', '#773706'], ['accent-public', '#B45309'],
    ['accent-ring', '#D16310'], ['accent-muted-alt', '#F1AA74'],
  ]);
  for (const [role, value] of amber) {
    const expected = contrastOnWhite(rgba(value)) < MIN_CONTRAST ? 1 : 0;
    assert.equal(scanner(amber)(`<button className="bg-${role} text-white"/>`, 'fixture.tsx').length, expected);
    count++;
  }
  return count + 8;
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const { refresh, selftest: onlyTest, srcArg } = args();
    if (refresh) throw Error('Снимка долга и автоматического допуска нет: исправьте контраст');
    console.log(`✓ no-white-on-fill: ${selftest()} самопроверок, включая смену значения и восстановление`);
    if (!onlyTest) {
      const root = srcArg || join(HERE, '..', 'src');
      process.exitCode = report('no-white-on-fill', inspectTree(root, scanner(readRoles(packageThemeCss()))));
    }
  } catch (error) { console.error(`✗ no-white-on-fill: ${error.message}`); process.exitCode = 1; }
}
