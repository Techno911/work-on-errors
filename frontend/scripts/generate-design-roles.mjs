#!/usr/bin/env node
/**
 * Генерирует src/lib/design-roles.generated.js — плоский список ролей
 * кегля/радиуса/тени/цвета пакета @chirkov/shell, литералом без node:fs и
 * node:module (эти два модуля Vite не умеет собрать для браузера — сама
 * fs-логика чтения theme.css/tokens.css живёт здесь, в Node-скрипте сборки,
 * а браузерный src/lib/tailwind-merge-config.js получает готовый литерал).
 * Источник — packageThemeCss() (frontend/scripts/gate-shared.mjs), тот же,
 * которым меряют css-перепись.py и остальные gate-скрипты платформы.
 *
 * Перегенерировать после апгрейда @chirkov/shell: node scripts/generate-design-roles.mjs.
 * npm run build и npm run dev делают это сами первым шагом — файл не более
 * чем кеш, драка версий с package-lock.json ему не грозит.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageThemeCss } from './gate-shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'src', 'lib', 'design-roles.generated.js');

function roleNames(css, prefix) {
  return [...css.matchAll(new RegExp(`--${prefix}-([\\w-]+)\\s*:`, 'g'))]
    .map((m) => m[1])
    .filter((role) => !role.endsWith('line-height'))
    .filter((role, i, all) => all.indexOf(role) === i);
}

const css = packageThemeCss();
const designRoles = {
  fontSize: roleNames(css, 'text'),
  radius: roleNames(css, 'radius'),
  shadow: roleNames(css, 'shadow'),
  color: roleNames(css, 'color'),
};

const body = `/**
 * СГЕНЕРИРОВАНО — не редактировать руками.
 * Источник: @chirkov/shell/theme.css + tokens.css (см. scripts/generate-design-roles.mjs).
 * Перегенерировать: node scripts/generate-design-roles.mjs
 */
export const designRoles = Object.freeze(${JSON.stringify(designRoles, null, 2)});
`;
writeFileSync(OUT, body, 'utf8');
console.log(`✓ generate-design-roles: ${Object.values(designRoles).reduce((n, l) => n + l.length, 0)} ролей записано в src/lib/design-roles.generated.js`);
