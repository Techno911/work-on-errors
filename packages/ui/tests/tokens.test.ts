import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function contrast(a: string, b: string) {
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(a), luminance(b)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

function tokenColor(css: string, name: string) {
  const values = new Map([...css.matchAll(/^\s*(--chip-[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1], match[2]]));
  let value = values.get(name);
  const visited = new Set<string>();
  while (value?.startsWith('var(')) {
    const next = value.match(/var\((--chip-[\w-]+)\)/)?.[1];
    if (!next || visited.has(next)) break;
    visited.add(next);
    value = values.get(next);
  }
  if (!value?.match(/^#[0-9a-f]{6}$/i)) throw new Error(`Нет цвета ${name}: ${value}`);
  return value;
}

describe('сборка токенов Figma', () => {
  it('округляет FLOAT до четырёх знаков и в обычном значении, и в режимах', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'chip-token-rounding-'));
    try {
      const input = JSON.parse(readFileSync(resolve(root, 'tokens/figma.json'), 'utf8'));
      const variable = input.переменные.find(
        (item: { css: string }) => item.css === '--chip-doc-text-base--line-height',
      );
      variable.значение = 1.5499999523162842;
      variable.значенияРежимов.Широкий.значение = 1.5499999523162842;
      variable.значенияРежимов.Узкий.значение = 1.5499999523162842;

      const inputPath = join(temporary, 'figma.json');
      const outputPath = join(temporary, 'out');
      writeFileSync(inputPath, JSON.stringify(input));
      execFileSync(process.execPath, ['scripts/tokens-build.mjs', inputPath, outputPath], { cwd: root });

      const css = readFileSync(join(outputPath, 'tokens.css'), 'utf8');
      expect(css).toContain('--chip-doc-text-base--line-height: 1.55;');
      expect(css).not.toContain('1.5499999523162842');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('выводит слой «Документ» под каноническими именами Tailwind', () => {
    const theme = readFileSync(resolve(root, 'src/theme.css'), 'utf8');
    const names = [
      '--color-doc-canvas', '--color-doc-surface', '--color-doc-surface-2',
      '--color-doc-border', '--color-doc-border-strong', '--color-doc-fg',
      '--color-doc-body', '--color-doc-fg-2', '--color-doc-fg-3',
      '--color-doc-formula', '--color-doc-accent', '--color-doc-accent-hover',
      '--color-doc-success', '--color-doc-danger', '--font-doc-display',
      '--shadow-doc-accent', '--tracking-overline',
    ];
    for (const size of ['xs', 'sm', 'base', 'lg', 'xl', '2xl', 'display']) {
      names.push(`--text-doc-${size}`, `--text-doc-${size}--line-height`);
    }
    for (const name of names) expect(theme).toContain(`${name}:`);
    expect(theme).not.toMatch(/--leading-/);
    expect(theme.match(/--tracking-[\w-]+:/g)).toEqual(['--tracking-overline:']);
  });

  it('ставит узкий режим до 1023,98 px, а печать возвращает широкие ступени', () => {
    const tokens = readFileSync(resolve(root, 'src/tokens.css'), 'utf8');
    const styles = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
    expect(tokens).toContain('@media (max-width: 1023.98px)');
    expect(tokens).toContain('--chip-doc-text-display: var(--chip-doc-size-44);');
    expect(styles).toMatch(/@media print[\s\S]*--chip-doc-text-display: var\(--chip-doc-size-78\)/);
  });

  it('держит сенсорный кегль только компонентным токеном, не ступенью темы', () => {
    const tokens = readFileSync(resolve(root, 'src/tokens.css'), 'utf8');
    const theme = readFileSync(resolve(root, 'src/theme.css'), 'utf8');
    expect(tokens).toContain('--chip-input-font-size-touch: 16px;');
    expect(theme).not.toContain('--input-font-size-touch:');
  });

  it('держит контраст кнопок документа не ниже 4,5:1', () => {
    const tokens = readFileSync(resolve(root, 'src/tokens.css'), 'utf8');
    const styles = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
    const pairs = [
      ['--chip-doc-fg', '--chip-doc-surface-2'],
      ['--chip-doc-fg', '--chip-doc-canvas'],
      ['--chip-doc-accent', '--chip-doc-canvas'],
      ['--chip-doc-accent-hover', '--chip-doc-canvas'],
    ];
    for (const [foreground, background] of pairs) {
      expect(contrast(tokenColor(tokens, foreground), tokenColor(tokens, background))).toBeGreaterThanOrEqual(4.5);
    }
    for (const variant of ['secondary', 'ghost', 'link']) {
      expect(styles).toContain(`[data-chip-doc] .chip-button--${variant}`);
    }
  });
});
