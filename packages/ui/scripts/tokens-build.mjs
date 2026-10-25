import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inputPath = resolve(root, process.argv[2] ?? 'tokens/figma.json');
const outputRoot = resolve(root, process.argv[3] ?? 'src');
const namesPath = resolve(root, 'tokens/tailwind-имена.json');

const input = JSON.parse(await readFile(inputPath, 'utf8'));
const names = JSON.parse(await readFile(namesPath, 'utf8'));
const variables = input.переменные;
const roundFloat = (value) => Math.round(value * 10000) / 10000;

if (!input.файл || !Array.isArray(variables)) {
  throw new Error('tokens/figma.json: ожидаются поля «файл» и «переменные»');
}

const byCss = new Map();
const modeNames = ['Широкий', 'Узкий'];

function validateValue(variable, value, label) {
  const { значение, ссылка } = value;
  if ((ссылка === null) === (значение === null)) {
    throw new Error(`${variable.css}${label}: нужно ровно одно из полей «значение» и «ссылка»`);
  }
}

for (const variable of variables) {
  const { css, тип, значение, ссылка, значенияРежимов } = variable;
  if (!/^--chip-[a-z0-9-]+$/.test(css ?? '')) {
    throw new Error(`${variable.коллекция}/${variable.имя}: WEB-синтаксис должен быть --chip-*`);
  }
  if (!['COLOR', 'FLOAT', 'STRING'].includes(тип)) {
    throw new Error(`${css}: неподдерживаемый тип ${тип}`);
  }
  validateValue(variable, { значение, ссылка }, '');
  if (значенияРежимов !== undefined) {
    if (!значенияРежимов || typeof значенияРежимов !== 'object' || Array.isArray(значенияРежимов)) {
      throw new Error(`${css}: «значенияРежимов» должны быть объектом`);
    }
    const actualModes = Object.keys(значенияРежимов);
    if (actualModes.length !== modeNames.length || modeNames.some((mode) => !actualModes.includes(mode))) {
      throw new Error(`${css}: ожидаются режимы ${modeNames.join(' и ')}`);
    }
    for (const mode of modeNames) validateValue(variable, значенияРежимов[mode], `, режим ${mode}`);
    if (JSON.stringify(значенияРежимов.Широкий) !== JSON.stringify({ значение, ссылка })) {
      throw new Error(`${css}: верхнеуровневое значение должно совпадать с режимом «Широкий»`);
    }
  }
  if (byCss.has(css)) throw new Error(`${css}: дубль WEB-имени`);
  byCss.set(css, variable);
}

for (const variable of variables) {
  if (variable.ссылка && !byCss.has(variable.ссылка)) {
    throw new Error(`${variable.css}: алиас ведёт в неизвестную переменную ${variable.ссылка}`);
  }
  for (const [mode, value] of Object.entries(variable.значенияРежимов ?? {})) {
    if (value.ссылка && !byCss.has(value.ссылка)) {
      throw new Error(`${variable.css}, режим ${mode}: алиас ведёт в неизвестную переменную ${value.ссылка}`);
    }
  }
}

function cssValue(variable, value = variable) {
  if (value.ссылка) return `var(${value.ссылка})`;
  if (variable.тип === 'FLOAT') {
    if (typeof value.значение !== 'number' || !Number.isFinite(value.значение)) {
      throw new Error(`${variable.css}: FLOAT должен быть числом`);
    }
    const rounded = roundFloat(value.значение);
    return variable.css.startsWith('--chip-doc-text-') && variable.css.endsWith('--line-height')
      ? String(rounded)
      : `${rounded}px`;
  }
  if (variable.тип === 'COLOR') {
    const color = String(value.значение).toLowerCase();
    if (!/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/.test(color)) {
      throw new Error(`${variable.css}: COLOR должен быть #rrggbb или #rrggbbaa`);
    }
    return color;
  }
  if (typeof value.значение !== 'string' || !value.значение.trim()) {
    throw new Error(`${variable.css}: STRING должен быть непустой строкой`);
  }
  return value.значение;
}

const groups = new Map();
for (const variable of variables) {
  const group = groups.get(variable.коллекция) ?? [];
  group.push(variable);
  groups.set(variable.коллекция, group);
}

const tokenLines = [':root {'];
for (const [collection, items] of groups) {
  tokenLines.push(`  /* ${collection} */`);
  for (const variable of items) tokenLines.push(`  ${variable.css}: ${cssValue(variable)};`);
  tokenLines.push('');
}
if (tokenLines.at(-1) === '') tokenLines.pop();
tokenLines.push('}', '');

const narrowVariables = variables.filter((variable) => variable.значенияРежимов);
if (narrowVariables.length) {
  tokenLines.push('@media (max-width: 1023.98px) {', '  :root {', '    /* Узкий */');
  for (const variable of narrowVariables) {
    tokenLines.push(`    ${variable.css}: ${cssValue(variable, variable.значенияРежимов.Узкий)};`);
  }
  tokenLines.push('  }', '}', '');
}

const themeEntries = [];
const seenTheme = new Map();
const excludedFromTheme = new Set(names.не_выводить_в_тему ?? []);
for (const variable of variables) {
  if (excludedFromTheme.has(variable.css)) continue;
  const themeName = names.исключения[variable.css] ?? variable.css.replace(/^--chip-/, '--');
  const previous = seenTheme.get(themeName);
  if (previous) throw new Error(`${themeName}: два CSS-токена (${previous} и ${variable.css})`);
  seenTheme.set(themeName, variable.css);
  themeEntries.push(`  ${themeName}: var(${variable.css});`);
}

const deprecated = names.устаревшие ?? {};
for (const [oldName, alias] of Object.entries(deprecated)) {
  if (seenTheme.has(oldName)) throw new Error(`${oldName}: устаревшее имя уже занято`);
  if (!seenTheme.has(alias)) throw new Error(`${oldName}: алиас ${alias} не существует`);
  themeEntries.push(`  ${oldName}: var(${alias});`);
  seenTheme.set(oldName, alias);
}

const missing021 = names.обязательные_0_2_1.filter((name) => !seenTheme.has(name));
if (missing021.length) throw new Error(`Из темы 0.2.1 исчезли имена: ${missing021.join(', ')}`);

const themeLines = [
  "@import './styles.css';",
  '',
  '/* Tailwind 4: импортируйте этот файл после `@import "tailwindcss"`. */',
  '@theme static {',
  ...themeEntries,
  '}',
  '',
];

await mkdir(outputRoot, { recursive: true });
await writeFile(resolve(outputRoot, 'tokens.css'), tokenLines.join('\n'));
await writeFile(resolve(outputRoot, 'theme.css'), themeLines.join('\n'));
console.log(`Токены: ${variables.length} переменных → ${outputRoot}`);
