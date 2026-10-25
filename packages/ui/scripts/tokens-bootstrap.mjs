import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname);
const tokensSource = await readFile(resolve(root, 'src/tokens.css'), 'utf8');
const themeSource = await readFile(resolve(root, 'src/theme.css'), 'utf8');
const names = JSON.parse(await readFile(resolve(root, 'tokens/tailwind-имена.json'), 'utf8'));
const output = resolve(root, process.argv[2] ?? 'tokens/figma.json');

const declarations = [...tokensSource.matchAll(/(--chip-[\w-]+)\s*:\s*([^;]+);/g)]
  .map(([, css, value]) => ({ css, value: value.trim() }));
const values = new Map(declarations.map((entry) => [entry.css, entry.value]));

// Решения 0.3 накладываются на стартовый словарь 0.2.1.
values.set('--chip-color-on-inverse-muted', 'var(--chip-color-ink-400)');
values.set('--chip-color-slate-400', 'var(--chip-color-on-inverse-muted)');
values.set('--chip-login-on-inverse-muted', 'var(--chip-color-on-inverse-muted)');
values.set('--chip-color-overlay', '#1a1a1a80');
values.set('--chip-color-hover', '#1a1a1a0a');
values.set('--chip-color-pressed', '#1a1a1a14');
values.set('--chip-color-inverse-divider', '#ffffff26');
values.set('--chip-color-accent-on-dark-subtle', '#f4a46726');
values.delete('--chip-radius-pill');
values.set('--chip-radius-9999', '9999px');
values.set('--chip-control-height-sm', '32px');
values.set('--chip-shadow-raised', '0 1px 2px rgba(26,26,26,0.06), 0 0 0 1px rgba(26,26,26,0.04)');
values.set('--chip-shadow-overlay', '0 16px 40px rgba(26,26,26,0.16), 0 4px 12px rgba(26,26,26,0.08)');
values.set('--chip-tracking-overline', '0.08em');

for (const [size, line] of [[12, 16], [13, 20], [15, 23], [18, 26], [22, 28], [26, 32], [44, 48]]) {
  values.set(`--chip-font-size-${size}`, `${size}px`);
  values.set(`--chip-font-size-${size}--line-height`, `${line}px`);
}

const typeRoles = [
  ['micro', 12], ['body', 13], ['body-lg', 15], ['title', 18],
  ['section', 22], ['page', 26], ['display', 44],
];
for (const [role, size] of typeRoles) {
  values.set(`--chip-text-${role}`, `var(--chip-font-size-${size})`);
  values.set(`--chip-text-${role}--line-height`, `var(--chip-font-size-${size}--line-height)`);
}

for (const [role, primitive] of [
  ['chip', '4'], ['field', '8'], ['control', '10'], ['block', '12'],
  ['card', '16'], ['pill', '9999'],
]) {
  values.set(`--chip-radius-${role}`, `var(--chip-radius-${primitive})`);
}

const primitiveColor = /^--chip-color-(ink|amber|green|red|blue)-(?:\d+|pale|subtle|divider|border|focus|base|hover|active|fg|fg-subtle|on-dark)$/;
const floatToken = /^--chip-(?:font-size-\d+(?:--line-height)?|text-|radius-|space-|control-height|login-form-width|login-panel-content-max|login-brand-title-line-height|login-breakpoint|login-wide-breakpoint)/;

function metadata(css, value) {
  if (primitiveColor.test(css) && !value.startsWith('var(')) {
    const [, family, shade] = css.match(/^--chip-color-([^-]+)-(.+)$/);
    return { коллекция: '01 Примитивы', имя: `Палитра/${family}/${shade}`, тип: 'COLOR' };
  }
  if (css.startsWith('--chip-color-') || css === '--chip-login-on-inverse-muted') {
    const compatibility = css === '--chip-color-slate-400' || css === '--chip-login-on-inverse-muted';
    return {
      коллекция: compatibility ? '99 Совместимость' : '02 Цвет',
      имя: compatibility ? `устаревшее/${css.slice(7)}` : `цвет/${css.slice(13)}`,
      тип: 'COLOR',
    };
  }
  if (css.startsWith('--chip-font-') || css.startsWith('--chip-text-') || css.startsWith('--chip-tracking-')) {
    const typeRole = css.match(/^--chip-text-([\w-]+?)(--line-height)?$/);
    const typeRoleNames = {
      micro: 'микро', body: 'основной', 'body-lg': 'крупный', title: 'заголовок',
      section: 'раздел', page: 'страница', display: 'витрина',
    };
    const name = typeRole
      ? `${typeRole[2] ? 'межстрочное' : 'кегль'}/роль/${typeRoleNames[typeRole[1]]}`
      : css.replace('--chip-', '').replace('font-size-', 'кегль/').replace('--line-height', '/межстрочное');
    return { коллекция: '04 Типографика', имя: name, тип: floatToken.test(css) ? 'FLOAT' : 'STRING' };
  }
  if (css.startsWith('--chip-shadow-')) {
    return { коллекция: '05 Тени', имя: `тень/${css.slice(14)}`, тип: 'STRING' };
  }
  const radiusRole = css.match(/^--chip-radius-(chip|field|control|block|card|pill)$/);
  const radiusRoleNames = {
    chip: 'чип', field: 'поле', control: 'контрол', block: 'блок', card: 'карточка', pill: 'пилюля',
  };
  const name = radiusRole
    ? `радиус/роль/${radiusRoleNames[radiusRole[1]]}`
    : css.replace('--chip-', '').replace('radius-', 'радиус/').replace('space-', 'отступ/').replace('control-height', 'высота/контрол');
  return { коллекция: '03 Размеры', имя: name, тип: floatToken.test(css) ? 'FLOAT' : 'STRING' };
}

const variables = [...values].map(([css, raw]) => {
  const meta = metadata(css, raw);
  const alias = raw.match(/^var\((--chip-[\w-]+)\)$/)?.[1] ?? null;
  let value = null;
  if (!alias) {
    value = meta.тип === 'FLOAT' ? Number(raw.replace(/px$/, '')) : raw;
  }
  return {
    ...meta,
    css,
    значение: value,
    ссылка: alias,
    описание: css === '--chip-color-slate-400' || css === '--chip-login-on-inverse-muted'
      ? 'Устаревший алиас; новый код его не использует.'
      : '',
  };
}).sort((a, b) => (a.коллекция + '/' + a.имя).localeCompare(b.коллекция + '/' + b.имя));

const oldThemeNames = [...themeSource.matchAll(/\s(--[\w-]+)\s*:/g)].map((match) => match[1]);
const excluded = new Set(names.не_выводить_в_тему ?? []);
const futureThemeNames = new Set(variables
  .filter((variable) => !excluded.has(variable.css))
  .map((variable) => names.исключения[variable.css] ?? variable.css.replace(/^--chip-/, '--')));
const lost = oldThemeNames.filter((name) => !futureThemeNames.has(name) && !names.устаревшие?.[name]);
if (lost.length) throw new Error(`Бутстрап удалил имена темы 0.2.1: ${lost.join(', ')}`);

await writeFile(output, JSON.stringify({ файл: '2PtSVLWHgzsZx07kSV5jhO', переменные: variables }, null, 2) + '\n');
console.log(`Bootstrap: ${variables.length} переменных → ${output}`);
