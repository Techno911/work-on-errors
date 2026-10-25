#!/usr/bin/env node
/**
 * Производная палитры исходящих HTML.
 *
 * До 23.09.2026 источником был frontend/src/index.css (местный словарь
 * ролей). Переезд на @chirkov/shell 0.3 убрал местный словарь целиком —
 * роли теперь в самом пакете (tokens.css + theme.css), поэтому и здесь
 * читаем их оттуда. Оба файла нужны вместе: theme.css объявляет
 * --color-X как алиас на --chip-color-Y, а сам --chip-color-Y (или ещё
 * один примитив вроде --chip-color-amber-base) определён в tokens.css.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL_DIST = join(BACKEND, '..', 'frontend', 'node_modules', '@chirkov', 'shell', 'dist');
export const CSS_PATH = [join(SHELL_DIST, 'tokens.css'), join(SHELL_DIST, 'theme.css')];
export const OUTPUT_PATH = join(BACKEND, 'src', 'mail', 'design-tokens.ts');

// Не regex: image/* внутри строкового литерала не является комментарием.
export function stripComments(text) {
  let out = '', mode = 'code', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (mode === 'code' && c === '/' && n === '*') { mode = 'block'; out += '  '; i++; continue; }
    if (mode === 'code' && c === '/' && n === '/') { mode = 'line'; out += '  '; i++; continue; }
    if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; out += '  '; i++; } else out += c === '\n' ? '\n' : ' '; continue; }
    if (mode === 'line') { if (c === '\n') { mode = 'code'; out += '\n'; } else out += ' '; continue; }
    out += c;
    if (mode === 'code' && (c === "'" || c === '"' || c === '`')) { mode = c; escaped = false; }
    else if (mode !== 'code') { if (c === mode && !escaped) mode = 'code'; escaped = c === '\\' && !escaped; }
  }
  return out;
}

export function resolveColorTokens(css) {
  // Все объявления, не только --color-*: цепочка --color-X → --chip-color-Y →
  // --chip-color-amber-base идёт через ДВА файла пакета (theme.css и
  // tokens.css), и промежуточные --chip-color-* нужны здесь же, чтобы её
  // развернуть. В EMAIL_COLORS попадают только конечные --color-* роли.
  const declarations = new Map();
  for (const m of stripComments(css).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) declarations.set(m[1], m[2].trim());
  const resolving = new Set();
  const resolve = (name) => {
    const value = declarations.get(name);
    if (!value) throw new Error(`в CSS нет --${name}`);
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (hex) return `#${hex[1].toUpperCase()}`;
    const alias = /^var\(--([\w-]+)\)$/.exec(value);
    if (!alias || resolving.has(name)) throw new Error(`--${name} не разворачивается в hex`);
    resolving.add(name); const result = resolve(alias[1]); resolving.delete(name); return result;
  };
  const tokens = {};
  for (const name of [...declarations.keys()].filter((n) => n.startsWith('color-')).sort()) {
    try { tokens[name] = resolve(name); } catch { /* alpha/gradient roles are not valid email literals */ }
  }
  return tokens;
}

export function renderDesignTokens(tokens) {
  const lines = Object.entries(tokens).map(([name, value]) => `  '${name}': '${value}',`);
  return `// GENERATED from @chirkov/shell (tokens.css + theme.css); do not edit.\nexport const EMAIL_COLORS = {\n${lines.join('\n')}\n} as const;\nexport type EmailColorToken = keyof typeof EMAIL_COLORS;\nexport const emailColor = (token: EmailColorToken) => EMAIL_COLORS[token];\n`;
}
const readCss = () => CSS_PATH.map((p) => readFileSync(p, 'utf8')).join('\n');
export function expectedDesignTokens(css = readCss()) { return renderDesignTokens(resolveColorTokens(css)); }
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const missing = CSS_PATH.filter((p) => !existsSync(p));
  if (missing.length) {
    console.log(`↷ производная палитра писем пропущена: нет ${missing.join(', ')} в текущем контексте (frontend/node_modules не установлен?)`);
    process.exit(0);
  }
  const expected = expectedDesignTokens();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUTPUT_PATH, 'utf8') !== expected) throw new Error('производная палитры расходится со словарём @chirkov/shell');
    console.log('✓ производная палитры синхронна');
  } else { writeFileSync(OUTPUT_PATH, expected); console.log('✓ производная палитры собрана'); }
}
