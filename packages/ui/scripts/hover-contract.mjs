import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const defaultCss = fileURLToPath(new URL('../src/styles.css', import.meta.url));

export function hoverOutsideCapableMedia(css) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const errors = [];
  let buffer = '';
  let line = 1;

  for (const char of source) {
    if (char === '\n') line += 1;
    if (char === '{') {
      const prelude = buffer.trim();
      const protectedByHoverMedia = stack.some((entry) => entry.hoverMedia);
      if (prelude.includes(':hover') && !protectedByHoverMedia) {
        errors.push({ line, selector: prelude.replace(/\s+/g, ' ') });
      }
      stack.push({ hoverMedia: /^@media\s*\([^)]*hover\s*:\s*hover[^)]*\)/.test(prelude) });
      buffer = '';
    } else if (char === '}') {
      stack.pop();
      buffer = '';
    } else if (char === ';') {
      buffer = '';
    } else {
      buffer += char;
    }
  }
  return errors;
}

const protectedSelectedSelectors = [
  ".chip-switch__option:hover:not(:disabled):not([aria-checked='true'])",
  ".chip-filter:hover:not(:disabled):not([aria-pressed='true'])",
  '.chip-list-row:hover:not(:disabled):not(.chip-list-row--accent):not(.chip-list-row--accent-soft)',
  ".chip-tabs__tab:hover:not(:disabled):not([aria-selected='true'])",
  ".chip-nav-item:hover:not([aria-disabled='true']):not([data-active='true']):not([aria-current='page'])",
];

export function missingSelectedHoverGuards(css) {
  return protectedSelectedSelectors.filter((selector) => !css.includes(selector));
}

function selftest() {
  const good = '@media (hover: hover) { .control:hover { color: red; } }';
  const bad = '.control:hover { color: red; }';
  const wrongMedia = '@media (max-width: 768px) { .control:hover { color: red; } }';
  if (hoverOutsideCapableMedia(good).length !== 0) throw new Error('ложное срабатывание на hover-capable media');
  if (hoverOutsideCapableMedia(bad).length !== 1) throw new Error('слом не пойман: hover вне media');
  if (hoverOutsideCapableMedia(wrongMedia).length !== 1) throw new Error('слом не пойман: hover в неверном media');
  if (missingSelectedHoverGuards(protectedSelectedSelectors.join('\n')).length !== 0) {
    throw new Error('ложное срабатывание на защищённые выбранные состояния');
  }
  if (missingSelectedHoverGuards('.chip-filter:hover').length !== protectedSelectedSelectors.length) {
    throw new Error('слом не пойман: выбранное состояние теряет защиту');
  }
  console.log('hover-contract selftest: слом пойман, ложных срабатываний нет');
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  const cssPath = process.argv[2] ?? defaultCss;
  const css = readFileSync(cssPath, 'utf8');
  const errors = hoverOutsideCapableMedia(css);
  const missingGuards = missingSelectedHoverGuards(css);
  if (errors.length) {
    for (const error of errors) console.error(`${cssPath}:${error.line}: :hover вне @media (hover: hover): ${error.selector}`);
    process.exit(1);
  }
  if (missingGuards.length) {
    for (const selector of missingGuards) console.error(`${cssPath}: выбранное состояние не защищено: ${selector}`);
    process.exit(1);
  }
  console.log(`hover-contract: ${cssPath} — все :hover защищены`);
}
