#!/usr/bin/env node
/**
 * Исходящая HTML-разметка обязана брать цвета через производную index.css.
 * Лексер комментариев общий с генератором: последовательность image/* в
 * строке не может спрятать нарушение, а настоящий комментарий исключается.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSS_PATH, OUTPUT_PATH, expectedDesignTokens, stripComments } from './build-mail-design-tokens.mjs';

const BACKEND = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTBOUND_SOURCE_ROOT = join(BACKEND, 'src');
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^)]*\)|\b(?:black|white|red|green|blue|yellow|orange|purple|teal)\b/i;
const COLOR_DECLARATION = /(?:^|[;"'`])\s*(?:background(?:-color)?|color|border(?:-(?:top|right|bottom|left))?)\s*:\s*([^;`"']*)/gim;

function sourceFiles(dir, result = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, result);
    else if (/\.ts$/.test(path) && !/\.(?:spec|test)\.ts$/.test(path) && !/design-tokens\.ts$/.test(path)) result.push(path);
  }
  return result;
}

function lineAt(text, index) {
  return text.slice(0, index).split('\n').length;
}

export function rawColorsInMarkup(text) {
  const clean = stripComments(text);
  const hits = [];
  for (const match of clean.matchAll(COLOR_DECLARATION)) {
    const literal = COLOR_LITERAL.exec(match[1]);
    if (literal) hits.push({ value: literal[0], at: match.index + match[0].indexOf(literal[0]) });
  }
  return hits;
}

function verifyMarkup() {
  const errors = [];
  for (const file of sourceFiles(OUTBOUND_SOURCE_ROOT)) {
    const source = readFileSync(file, 'utf8');
    if (!/(?:style\s*=|<style\b|<!doctype|<table\b|<div\b|<a\b)/i.test(source)) continue;
    for (const hit of rawColorsInMarkup(source)) {
      errors.push(`${file.replace(`${BACKEND}/`, '')}:${lineAt(source, hit.at)} «${hit.value}» — цвет числом в исходящей разметке`);
    }
  }
  return errors;
}

export function checkDerivative({ cssPath = CSS_PATH, outputPath = OUTPUT_PATH } = {}) {
  if (!existsSync(cssPath)) {
    return { skipped: true, errors: [`${cssPath} недоступен в этом контексте сборки`] };
  }
  let actual = '';
  try { actual = readFileSync(outputPath, 'utf8'); } catch { /* error is rendered below */ }
  return {
    skipped: false,
    errors: actual === expectedDesignTokens(readFileSync(cssPath, 'utf8'))
      ? []
      : [`${outputPath.replace(`${BACKEND}/`, '')} расходится с ${cssPath.replace(`${BACKEND}/`, '')}; выполните node scripts/build-mail-design-tokens.mjs`],
  };
}

function verifyDerivative() {
  const result = checkDerivative();
  if (result.skipped) {
    console.log(`↷ сверка производной палитры пропущена: ${result.errors[0]}`);
  }
  return result;
}

function selfTest() {
  const errors = [];
  const raw = rawColorsInMarkup('<a style="background:#B45309;color:#fff">x</a>');
  if (raw.length !== 2) errors.push(`не поймал два числовых цвета (${raw.length})`);
  const stringThenViolation = rawColorsInMarkup('const accept = "image/*"; const html = `<a style="background:#B45309">x</a>`;');
  if (stringThenViolation.length !== 1) errors.push(`image/* внутри строки скрыл нарушение (${stringThenViolation.length})`);
  const commentWithViolation = rawColorsInMarkup('/* const html = `<a style="background:#B45309">x</a>`; */ const html = `<a style="background:${emailColor(\'color-accent-solid\')}">x</a>`;');
  if (commentWithViolation.length !== 0) errors.push(`настоящий комментарий не проигнорирован (${commentWithViolation.length})`);
  const clean = rawColorsInMarkup('<a style="background:${emailColor(\'color-accent-solid\')};color:${emailColor(\'color-on-dark\')}">x</a>');
  if (clean.length !== 0) errors.push('поругался на производную палитры');
  const css = ':root { --color-base: #123456; --color-role: var(--color-base); }';
  if (expectedDesignTokens(css) === expectedDesignTokens(css.replace('#123456', '#654321'))) errors.push('не ловит расхождение производной с источником');
  const skipped = checkDerivative({ cssPath: join(BACKEND, '__css_source_is_absent__.css') });
  if (!skipped.skipped || skipped.errors.length !== 1) errors.push('не сообщает честно о недоступном CSS-источнике');
  const drift = checkDerivative({ outputPath: join(BACKEND, '__tokens_are_absent__.ts') });
  if (drift.skipped || drift.errors.length !== 1) errors.push('не ловит расхождение производной с доступным источником');
  if (errors.length) {
    console.error('✗ САМОПРОВЕРКА замка исходящих HTML:\n' + errors.map((error) => `  · ${error}`).join('\n'));
    process.exit(1);
  }
  console.log('✓ mail-color-check: literal ловится после image/*, комментарий игнорируется, производная проверена и недоступный источник отмечается явно');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  const derivative = verifyDerivative();
  const errors = [...derivative.errors.filter((error) => !derivative.skipped), ...verifyMarkup()];
  if (errors.length) {
    console.error('✗ ЗАМОК ПАЛИТРЫ ИСХОДЯЩИХ HTML:');
    for (const error of errors) console.error(`  · ${error}`);
    process.exit(1);
  }
  console.log(`✓ палитра исходящих HTML: числовых цветов в разметке нет; ${derivative.skipped ? 'сверка производной пропущена без CSS-источника' : 'производная синхронна'}`);
}
