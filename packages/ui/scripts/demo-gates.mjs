import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
// Ворота выпуска (prepack): те же замеры на ширинах 360 и 390 вместо полной матрицы.
const narrow = process.argv.includes('--narrow');
const widths = narrow ? '360,390' : '360,390,768,1280,1440';
const python = process.env.WEBCHECK_PYTHON || 'python3';
const webcheck = process.env.WEBCHECK_SCRIPT || 'webcheck.py';
const pages = [
  { path: '/components', label: 'Оболочка и компоненты' },
  { path: '/login', label: 'Вход с обещанием Точки' },
  { path: '/document', label: 'Слой «Документ»' },
  { path: '/modal', label: 'Модальное окно' },
  { path: '/modal-sm', label: 'Модальное окно sm' },
  { path: '/modal-lg', label: 'Модальное окно lg' },
  { path: '/dropdown', label: 'Открытое меню действий' },
  { path: '/topbar-one-icon', label: 'TopBar с одной кнопкой-иконкой' },
  { path: '/topbar-icon-button', label: 'TopBar с иконкой и кнопкой' },
  { path: '/topbar-three-actions', label: 'TopBar с тремя действиями' },
  { path: '/topbar-long-title', label: 'TopBar с длинным заголовком' },
  { path: '/topbar-back', label: 'TopBar с кнопкой назад' },
  { path: '/topbar-description', label: 'TopBar с описанием' },
  { path: '/topbar-description-actions', label: 'TopBar с длинным описанием и тремя действиями' },
  { path: '/breadcrumbs', label: 'Динамические крошки' },
  { path: '/tables', label: 'Таблицы данных и палитра категорий' },
];

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, ...options });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += chunk; });
    child.stderr?.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      process.stdout.write(output);
      if (code === 0) resolveRun(output);
      else reject(new Error(`${command} завершился с кодом ${code}`));
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForPreview(url, preview) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (preview.exitCode !== null) throw new Error('vite preview завершился до проверки');
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Сервер ещё поднимается.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('vite preview не поднялся за 8 секунд');
}

function assertNoRenderedFindings(report) {
  const findings = [];
  for (const [platform, data] of Object.entries(report)) {
    for (const [kind, values] of Object.entries(data.вне_системы ?? {})) {
      for (const value of Object.keys(values)) {
        const examples = data.примеры?.[`${kind}=${value}`] ?? [];
        findings.push(`${platform}.${kind}: ${value}${examples.length ? ` · ${examples.join('; ')}` : ''}`);
      }
    }
  }
  if (findings.length) throw new Error(`Перепись витрины нашла значения вне системы:\n${findings.join('\n')}`);
}

function assertNoCssFindings(report) {
  const findings = Object.entries(report.вне_системы ?? {})
    .filter(([, values]) => Object.keys(values).length)
    .map(([kind, values]) => `${kind}: ${Object.keys(values).join(', ')}`);
  const localTokens = Object.keys(report.местные_токены ?? {});
  if (localTokens.length) findings.push(`местные токены: ${localTokens.join(', ')}`);
  if (findings.length) throw new Error(`CSS витрины вышел за систему:\n${findings.join('\n')}`);
}

const temporary = await mkdtemp(join(tmpdir(), 'chip-shell-gate-'));
const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const preview = spawn(resolve(root, 'node_modules/.bin/vite'), [
  'preview', '--config', 'vite.demo.config.ts', '--host', '127.0.0.1',
  '--port', String(port), '--strictPort',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

let previewOutput = '';
preview.stdout.on('data', (chunk) => { previewOutput += chunk; });
preview.stderr.on('data', (chunk) => { previewOutput += chunk; });

try {
  await waitForPreview(base, preview);

  if (narrow) {
    await run(python, ['scripts/webcheck-narrow.py', webcheck, base, ...pages.map((page) => page.path)]);
  }
  for (const page of narrow ? [] : pages) {
    const reportPath = join(temporary, `webcheck-${page.path.slice(1)}.json`);
    await run(python, [webcheck, `${base}${page.path}`, '--quick', '--json', reportPath]);
  }

  await run(python, ['scripts/layout-contract.py', `${base}/components`]);

  const planPath = join(temporary, 'план.json');
  const outputPath = join(temporary, 'перепись');
  await writeFile(planPath, JSON.stringify({
    shell: {
      имя: '@chirkov/shell — витрина',
      база: base,
      сеанс: null,
      страницы: pages.map((page) => ({ путь: page.path, что: page.label })),
    },
  }, null, 2));

  // Сам замок проверяется до того, как ему верить: selftest ломает каждый вид нарочно.
  await run(python, ['gate/перепись.py', '--selftest']);
  await run(python, ['gate/перепись.py', '--план', planPath, '--выход', outputPath, '--ширины', widths]);
  const rendered = JSON.parse(await readFile(join(outputPath, 'перепись.json'), 'utf8'));
  assertNoRenderedFindings(rendered);

  const assets = resolve(root, 'dist-demo/assets');
  const cssFiles = (await readdir(assets)).filter((name) => name.endsWith('.css')).map((name) => join(assets, name));
  if (!cssFiles.length) throw new Error('В dist-demo/assets нет CSS для проверки');
  const cssReportPath = join(temporary, 'css.json');
  await run(python, ['gate/css-перепись.py', ...cssFiles, '--json', cssReportPath, '--код', 'shell']);
  const css = JSON.parse(await readFile(cssReportPath, 'utf8'));
  assertNoCssFindings(css);

  console.log(`Витрина: ${narrow ? 'замер 360/390' : 'webcheck quick'} — ${pages.length} страниц без ломающих находок; `
    + `перепись — ${pages.length} страниц × ${widths.split(',').length} ширин, вне системы 0; `
    + 'CSS вне системы 0, местных токенов 0.');
} catch (error) {
  if (previewOutput) process.stderr.write(previewOutput);
  if (narrow) console.error('ВОРОТА ВЫПУСКА КРАСНЫЕ: замер витрины на 360/390 не пройден, выпуск остановлен.');
  throw error;
} finally {
  preview.kill('SIGTERM');
  await rm(temporary, { recursive: true, force: true });
}
