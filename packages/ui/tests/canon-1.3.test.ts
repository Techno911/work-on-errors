import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), 'src', relativePath), 'utf8');

describe('второй слой сетки входа, канон 1.3', () => {
  const tokens = source('tokens.css');
  const styles = source('styles.css');

  it('фиксирует общую служебную краску и точную строку названия', () => {
    expect(tokens).toContain('--chip-color-on-inverse-muted: var(--chip-color-ink-400);');
    expect(tokens).toContain('--chip-login-on-inverse-muted: var(--chip-color-on-inverse-muted);');
    expect(tokens).toContain('--chip-login-brand-title-line-height: 23px;');
    expect(styles).toMatch(
      /\.chip-brand-logo__product\s*\{[^}]*font-size: var\(--chip-font-size-15\)[^}]*font-weight: 600[^}]*line-height: var\(--chip-login-brand-title-line-height\)/s,
    );
    expect(styles).toMatch(
      /\.chip-brand-logo--light \.chip-brand-logo__subtitle\s*\{[^}]*color: var\(--chip-login-on-inverse-muted\)/s,
    );
    expect(styles).toMatch(
      /\.chip-login__footer\s*\{[^}]*color: var\(--chip-login-on-inverse-muted\)/s,
    );
  });

  it('фиксирует кегль поля и насыщенности надзаголовка и главной кнопки', () => {
    expect(styles).toMatch(
      /\.chip-login__promise-copy h2\s*\{[^}]*font-size: var\(--chip-font-size-44\)[^}]*font-weight: 600[^}]*line-height: var\(--chip-font-size-44--line-height\)/s,
    );
    expect(styles).toMatch(
      /\.chip-login__promise-copy li > span\s*\{[^}]*background: var\(--chip-color-accent-on-dark-subtle\)[^}]*color: var\(--chip-color-accent-on-dark\)[^}]*font-family: var\(--chip-font-mono\)[^}]*font-size: var\(--chip-font-size-12\)/s,
    );
    expect(styles).toMatch(
      /\.chip-input\s*\{[^}]*font-size: var\(--chip-font-size-15\)/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 768px\)[\s\S]*?\.chip-input,[\s\S]*?\.chip-textarea,[\s\S]*?\.chip-select select\s*\{[^}]*font-size: var\(--chip-input-font-size-touch\)/,
    );
    expect(styles).toMatch(
      /\.chip-login__overline\s*\{[^}]*font-weight: 500/s,
    );
    expect(styles).toMatch(
      /\.chip-button\s*\{[^}]*font-size: var\(--chip-font-size-15\)[^}]*font-weight: 600/s,
    );
  });

  it('не срезает подпись Button при увеличенном системном тексте', () => {
    const buttonBlock = styles.match(/\.chip-button\s*\{([^}]*)\}/s)?.[1] ?? '';
    const labelBlock = styles.match(/\.chip-button__label\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(buttonBlock).toContain('min-height: var(--chip-control-height)');
    expect(buttonBlock).not.toMatch(/(^|\s)height:/);
    expect(labelBlock).toContain('text-wrap: balance');
    expect(labelBlock).toContain('white-space: normal');
    expect(labelBlock).not.toContain('text-overflow');
    expect(labelBlock).not.toContain('overflow: hidden');
  });

  it('не уменьшает min-content переносом anywhere', () => {
    expect(styles).not.toContain('overflow-wrap: anywhere');
    for (const selector of [
      '.chip-list-row__status',
      '.chip-list-row__title',
      '.chip-list-row__meta',
      '.chip-tooltip__bubble',
      '.chip-card__title',
      '.chip-card__description',
    ]) {
      const blocks = [...styles.matchAll(new RegExp(`${selector.replace('.', '\\\.')}\\s*\\{([^}]*)\\}`, 'gs'))];
      expect(blocks.some((match) => match[1].includes('overflow-wrap: break-word'))).toBe(true);
    }
    for (const selector of ['.chip-switch__label']) {
      const blocks = [...styles.matchAll(new RegExp(`${selector.replace('.', '\\\.')}\\s*\\{([^}]*)\\}`, 'gs'))];
      expect(blocks.some((match) => match[1].includes('overflow-wrap: normal'))).toBe(true);
    }
    const legacyFileAction = [...styles.matchAll(/\.chip-file-field__action\s*\{([^}]*)\}/gs)];
    expect(legacyFileAction.every((match) => match[1].includes('overflow-wrap: normal'))).toBe(true);
  });
});
