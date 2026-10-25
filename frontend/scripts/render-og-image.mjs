#!/usr/bin/env node
/** Рендерит локальный HTML-источник OG в готовую картинку 1200×630. */
import { copyFileSync, existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FRONTEND = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_SOURCE = join(FRONTEND, 'scripts', 'og-image.source.html');
const DEFAULT_OUTPUT = join(FRONTEND, 'public', 'og-image.png');
const CHROMIUM_VERSION = '149.0.7827.53';
const RENDER_IMAGE = 'ro-og-renderer:149.0.7827.53-r0';
const chromeCandidates = [
  process.env.OG_BROWSER_BIN,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : resolve(process.argv[at + 1]);
}

function chrome() {
  const found = chromeCandidates.find(existsSync);
  if (!found) throw new Error('Не найден закреплённый Linux Chromium для рендера OG');
  const version = spawnSync(found, ['--version'], { encoding: 'utf8', timeout: 10000 });
  if (version.status !== 0 || !version.stdout.includes(`Chromium ${CHROMIUM_VERSION} `)) {
    throw new Error(`OG требует Chromium ${CHROMIUM_VERSION}: ${version.stdout.trim()}`);
  }
  return found;
}

export function prepareHtml(source) {
  let html = readFileSync(source, 'utf8');
  // Цвет живёт в словаре @chirkov/shell (переезд 23.09.2026), но OG-рендер
  // работает и в изолированной песочнице static-brand-assets-check.mjs
  // --selftest, которая копирует только scripts/public/src без node_modules.
  // Поэтому резолвленные литералы зафиксированы og-roles.json (см. комментарий
  // там же — как перегенерировать после апгрейда пакета), а не читаются из
  // пакета в рантайме. Шрифт остаётся местным — index.css платформы всё ещё
  // объявляет --font-body/--font-mono.
  const css = readFileSync(join(FRONTEND, 'src/index.css'), 'utf8');
  const colorRoles = JSON.parse(readFileSync(join(FRONTEND, 'scripts/og-roles.json'), 'utf8'));
  html = html.replace(/__ROLE_([A-Z_]+)__/g, (_, role) => {
    const name = '--' + role.toLowerCase().replaceAll('_', '-');
    if (name.startsWith('--color-')) {
      const bare = name.slice('--color-'.length);
      if (!(bare in colorRoles)) throw new Error(`Роль ${name}: не найдена в og-roles.json`);
      return colorRoles[bare];
    }
    const matches = [...css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))];
    if (matches.length !== 1) throw new Error(`Роль ${name}: ожидалось одно определение, найдено ${matches.length}`);
    return matches[0][1].trim();
  });
  // Пакет везёт Inter статичными начертаниями по весу (без переменного файла
  // на все 100-900 разом), кириллица отдельным набором woff2 — заголовок и
  // подпись OG набраны кириллицей, латинский набор глифов не подошёл бы.
  // Байты скопированы из @chirkov/shell в scripts/og-fonts (см. его LICENSE.txt)
  // — тоже ради песочницы --selftest без node_modules. Используемые в
  // шаблонах веса — 600, 700 и 800 (последний матчится на 700 штатным CSS
  // font-matching: точного начертания 800 у Inter Static нет).
  const faces = [400, 600, 700].map((weight) => {
    const file = readFileSync(join(FRONTEND, `scripts/og-fonts/inter-cyrillic-${weight}-normal.woff2`));
    return `@font-face { font-family: 'Inter'; src: url('data:font/woff2;base64,` +
      `${file.toString('base64')}') format('woff2'); font-weight: ${weight}; ` +
      `font-style: normal; font-display: block; }`;
  }).join('\n  ');
  html = html.replace('__INTER_FONT_FACES__', faces);
  html = html.replace('src="../public/logo/logo-mark.svg"', `src="${pathToFileURL(join(FRONTEND, 'public/logo/logo-mark.svg')).href}"`);
  if (/__[A-Z_]+__/.test(html)) throw new Error('В OG остался нераскрытый плейсхолдер');
  if (/<script\b|(?:src|href)\s*=\s*["']https?:|url\(\s*["']?https?:/i.test(html)) {
    throw new Error('OG-источник должен быть статическим и полностью локальным');
  }
  return html;
}

function renderInLinux(source, output) {
  const sourceRelative = relative(FRONTEND, source);
  if (sourceRelative.startsWith('..') || isAbsolute(sourceRelative)) throw new Error('OG-источник должен лежать внутри frontend');
  if (spawnSync('docker', ['image', 'inspect', RENDER_IMAGE], { stdio: 'ignore' }).status !== 0) {
    const build = spawnSync('docker', ['build', '--target', 'og-renderer', '-t', RENDER_IMAGE, FRONTEND], { encoding: 'utf8', timeout: 300000 });
    if (build.status !== 0) throw new Error(`Не собран OG-рендерер: ${build.stderr}`);
  }
  mkdirSync(dirname(output), { recursive: true });
  const run = spawnSync('docker', ['run', '--rm', '--pull', 'never', '--network', 'none',
    '-v', `${FRONTEND}:/app:ro`, '-v', `${dirname(output)}:/output`,
    RENDER_IMAGE, 'node', '/app/scripts/render-og-image.mjs', '--source', `/app/${sourceRelative}`,
    '--output', `/output/${basename(output)}`,
  ], { encoding: 'utf8', timeout: 60000 });
  if (run.status !== 0) throw new Error(`Linux OG-рендер: ${run.stderr || run.stdout}`);
}

export async function render(source = argument('--source', DEFAULT_SOURCE), output = argument('--output', DEFAULT_OUTPUT)) {
  const extension = extname(output).toLowerCase();
  if (!['.png', '.jpg', '.jpeg'].includes(extension)) throw new Error('OG-рендер поддерживает PNG и JPEG');
  if (process.platform !== 'linux') return renderInLinux(source, output);
  const temp = mkdtempSync(join(tmpdir(), 'ro-og-render-'));
  let browser;
  try {
    const prepared = join(temp, 'og.html');
    writeFileSync(prepared, prepareHtml(source));
    // CDP задаёт размер именно viewport. CLI --window-size включает служебную
    // высоту окна Chromium и возвращал innerHeight=487 при обещанных 630.
    browser = spawn(chrome(), ['--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
      '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none',
      '--allow-file-access-from-files', `--user-data-dir=${join(temp, 'profile')}`, '--remote-debugging-pipe',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
    let sequence = 0, buffer = '';
    const pending = new Map();
    const events = new Map();
    browser.stdio[4].on('data', chunk => {
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf('\0')) !== -1) {
        const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
        if (message.id) {
          const task = pending.get(message.id);
          if (task) { pending.delete(message.id); message.error ? task.reject(new Error(JSON.stringify(message.error))) : task.resolve(message.result); }
        } else if (events.has(message.method)) { events.get(message.method)(); events.delete(message.method); }
      }
    });
    const send = (method, params = {}, sessionId) => new Promise((resolveCall, rejectCall) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); rejectCall(new Error(`Chromium timeout: ${method}`)); }, 15000);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolveCall(value); }, reject: error => { clearTimeout(timer); rejectCall(error); } });
      browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? {sessionId} : {}) }) + '\0');
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Emulation.setDeviceMetricsOverride', { width:1200, height:630, deviceScaleFactor:1, mobile:false }, sessionId);
    const loaded = new Promise((resolveLoad, rejectLoad) => {
      const timer = setTimeout(() => rejectLoad(new Error('OG page load timeout')), 15000);
      events.set('Page.loadEventFired', () => { clearTimeout(timer); resolveLoad(); });
    });
    await send('Page.navigate', { url: pathToFileURL(prepared).href }, sessionId);
    await loaded;
    const measured = await send('Runtime.evaluate', { awaitPromise:true, returnByValue:true, expression:`
      document.fonts.ready.then(() => {
        const selectors = ['.kicker', 'h1', '.accent-line', '.sub', '.lead', '.chip', '.domain', '.mark', '.brand-name'];
        const boxes = selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(el => {
          const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
          return {selector, text: el.innerText || '', x:r.x, y:r.y, width:r.width, height:r.height,
            right:r.right, bottom:r.bottom, scrollWidth:el.scrollWidth, clientWidth:el.clientWidth,
            font:s.fontFamily, fontSize:s.fontSize, color:s.color};
        }));
        return {width:innerWidth, height:innerHeight,
          fontLoaded:document.fonts.check('700 22px Inter'), boxes};
      });
    ` }, sessionId);
    if (measured.exceptionDetails) throw new Error('OG-замер не выполнен после загрузки шрифта');
    const metrics = measured.result.value;
    if (!metrics.fontLoaded || metrics.width !== 1200 || metrics.height !== 630) throw new Error(`Неверный шрифт или размер OG: ${JSON.stringify(metrics)}`);
    const clipped = metrics.boxes.filter(b => b.x < 0 || b.y < 0 || b.right > 1200 || b.bottom > 630 || b.scrollWidth > b.clientWidth + 1);
    if (clipped.length) throw new Error(`OG обрезан: ${JSON.stringify(clipped)}`);
    const format = extension === '.png' ? 'png' : 'jpeg';
    const { data } = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? {quality:90} : {}), captureBeyondViewport:false }, sessionId);
    const encoded = Buffer.from(data, 'base64');
    const decoded = await send('Runtime.evaluate', {awaitPromise:true, returnByValue:true, expression:
      `new Promise((resolve, reject) => {const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = reject; image.src = 'data:image/${format};base64,${data}';})`
    }, sessionId);
    if (decoded.exceptionDetails || JSON.stringify(decoded.result.value) !== '[1200,630]') throw new Error('OG-изображение не 1200×630');
    writeFileSync(output, encoded);
    writeFileSync(`${output}.metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
    await send('Browser.close');
  } finally {
    if (browser && browser.exitCode === null && browser.signalCode === null) {
      // Browser.close отвечает до завершения процесса и записи профиля.
      // Даём Chromium закончить штатно; аварийный путь ограничен пятью секундами.
      await new Promise(resolveExit => {
        const timer = setTimeout(() => browser.kill('SIGKILL'), 5000);
        browser.once('close', () => { clearTimeout(timer); resolveExit(); });
      });
    }
    // Дочерние процессы могут завершить последние записи чуть позже родителя.
    rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await render();
  console.log('✓ OG-картинка пересобрана из HTML-источника');
}
