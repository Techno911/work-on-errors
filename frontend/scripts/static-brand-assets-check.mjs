#!/usr/bin/env node
/**
 * Статические носители бренда не проходят через CSS-сборку. Их источники и
 * собранные файлы фиксируются вместе, чтобы смена рампы не могла вернуться в
 * картинку незаметно.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, cpSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { render } from './render-og-image.mjs';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv.includes('--selftest')) {
  const fixture = mkdtempSync(join(tmpdir(), 'ro-og-selftest-'));
  try {
    for (const name of ['scripts', 'public', 'src']) {
      mkdirSync(join(fixture, name), { recursive: true });
    }
    for (const name of ['static-brand-assets-check.mjs', 'render-og-image.mjs', 'og-image.source.html', 'og-image.snapshot.json', 'og-crm-setup.source.html', 'og-crm-setup.snapshot.json', 'og-fonts', 'og-roles.json']) {
      cpSync(resolve(root, 'scripts', name), join(fixture, 'scripts', name), { recursive: true });
    }
    for (const name of ['favicon.svg', 'og-image.png', 'og-crm-setup.jpg', 'logo']) {
      cpSync(resolve(root, 'public', name), join(fixture, 'public', name), { recursive: true });
    }
    for (const name of ['Dockerfile', 'src/index.css']) cpSync(resolve(root, name), join(fixture, name));
    const check = () => spawnSync(process.execPath, [join(fixture, 'scripts/static-brand-assets-check.mjs')], { encoding: 'utf8', timeout: 60000 });
    const clean = check();
    if (clean.status !== 0) throw new Error(`Чистая копия не прошла: ${clean.stderr}`);
    const cases = [
      ['scripts/og-image.source.html', data => Buffer.concat([data, Buffer.from('\n<!-- drift -->')])],
      ['scripts/og-fonts/inter-cyrillic-700-normal.woff2', data => Buffer.concat([data, Buffer.from([0])])],
      ['scripts/og-roles.json', data => Buffer.from(data.toString().replace('"#1a1a1a"', '"#2a1a1a"'))],
      ['public/og-image.png', data => Buffer.concat([data, Buffer.from([0])])],
      ['scripts/og-crm-setup.source.html', data => Buffer.concat([data, Buffer.from('\n<!-- drift -->')])],
      ['public/og-crm-setup.jpg', data => Buffer.concat([data, Buffer.from([0])])],
      // CSS не входит в снимок файла: именно пересборка обязана поймать смену шрифта.
      ['src/index.css', data => Buffer.from(data.toString().replace("--font-body: 'Inter', system-ui, -apple-system, sans-serif;", "--font-body: 'Arial', system-ui, -apple-system, sans-serif;"))],
    ];
    for (const [path, mutate] of cases) {
      const target = join(fixture, path);
      const original = readFileSync(target);
      const changed = mutate(original);
      if (changed.equals(original)) throw new Error(`Контрольная мутация ${path} не сработала`);
      writeFileSync(target, changed);
      const result = check();
      writeFileSync(target, original);
      if (result.status !== 1 || !result.stderr.includes('Статический бренд-артефакт')) {
        throw new Error(`Замок не поймал ${path}: ${result.status} ${result.stderr}`);
      }
    }
    const restored = check();
    if (restored.status !== 0) throw new Error(`Восстановленная копия не прошла: ${restored.stderr}`);
    console.log('✓ static-brand-assets selftest: 7 сломов пойманы; чистая и восстановленная копии прошли');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
  process.exit(0);
}
const textAssets = [
  {
    path: 'public/favicon.svg',
    // Канон оболочки 1.0 §12: значок один на все платформы, копия эталона
    // «Продукты/Дизайн-система платформ/08 Общие элементы/эталон/вкладка/favicon.svg».
    sha256: 'dc24dbddea59cd41ff3eb684679420cfb275047e4a6ef066504c1be0862e52de',
  },
];

function sha256(path) {
  return createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');
}

const errors = [];
for (const asset of textAssets) {
  const actual = sha256(asset.path);
  if (actual !== asset.sha256) errors.push(`${asset.path}: ${actual} ≠ ${asset.sha256}`);
}

// И Mac, и Linux пересобирают одним закреплённым Linux Chromium.
// Снимки защищают источники/шрифт/рендерер/растры, пересборка — связь с ролями CSS.
const renderedOgs = ['og-image', 'og-crm-setup']
  .filter(name => existsSync(resolve(root, `scripts/${name}.snapshot.json`)))
  .map(name => JSON.parse(readFileSync(resolve(root, `scripts/${name}.snapshot.json`), 'utf8')));
if (renderedOgs.length === 0) {
  console.log('static-brand-assets: OG-снимков нет (превью-растры в пакете отсутствуют) — проверяю только статические знаки');
}
for (const renderedOg of renderedOgs) {
  for (const [path, expected] of Object.entries(renderedOg.sha256)) {
    const actual = sha256(path);
    if (actual !== expected) errors.push(`${path}: ${actual} ≠ ${expected}`);
  }
}
if (errors.length === 0) {
  for (const renderedOg of renderedOgs) {
    const renderDir = mkdtempSync(join(tmpdir(), 'ro-og-check-'));
    try {
      const rebuilt = join(renderDir, renderedOg.output.split('/').at(-1));
      await render(resolve(root, renderedOg.source), rebuilt);
      const expected = sha256(renderedOg.output);
      const actual = sha256(rebuilt);
      if (actual !== expected) errors.push(`${renderedOg.output}: ${expected} ≠ пересборка ${actual}`);
    } catch (error) {
      errors.push(`не удалось пересобрать ${renderedOg.output}: ${error instanceof Error ? error.message : error}`);
    } finally {
      rmSync(renderDir, { recursive: true, force: true });
    }
  }
}

if (errors.length > 0) {
  console.error('Статический бренд-артефакт изменён без одновременной пересборки и обновления снимка:');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`✓ static-brand-assets: ${renderedOgs.length} OG-пересборки, ${textAssets.length} статических знаков; checksum и Linux-пересборки совпали`);
