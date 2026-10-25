#!/usr/bin/env node
/**
 * Живая браузерная проверка возврата долга «белый на заливке» и «одно кольцо
 * фокуса»: реальные компоненты (Button/cn/Input/Textarea/Select), реальный
 * index.css, реальный Chromium через CDP — без API и без мока сети.
 *
 * Сравнивает исходную редакцию e1aed2e с текущим рабочим деревом (оно ещё не
 * закоммичено, поэтому берётся с диска, а не из git).
 *
 * Строит и проверяет четыре группы:
 *   1) реальная кнопка «Отправить на ревью» из SelfReviewForm.tsx
 *      (canSubmit=true, submitting=false) — контраст белого на заливке;
 *   2) шесть пар Input/Textarea/Select (normal/error) из старого и нового
 *      input.tsx — геометрия и фокусная обводка;
 *   3) изолированные фрагменты по каждому уникальному литералу из 84 удалённых
 *      локальных focus-колец — вычисленный :focus-visible и отсутствие
 *      локального ring/outline после правки;
 *   4) все 8 сохранённых постоянных колец — computed boxShadow до/после
 *      (обязано быть неизменным, это не фокус).
 *
 * Пишет frontend/scripts/debt-browser-results.json. Ничего не коммитит,
 * ничего не правит в src — только читает (git show / readFileSync).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import ts from '../node_modules/typescript/lib/typescript.js';
import { createServer } from '../node_modules/vite/dist/node/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const repo = resolve(frontend, '..');
const BASELINE = 'e1aed2e';
const CHROME = '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta';

const oldRepoPath = (repoRelPath) => execFileSync('git', ['show', `${BASELINE}:${repoRelPath}`], { cwd: repo, encoding: 'utf8' });
const oldSrc = (rel) => oldRepoPath(`frontend/src/${rel}`);
const curSrc = (rel) => readFileSync(join(frontend, 'src', rel), 'utf8');

/* ------------------------------------------------------------------ */
/* AST: извлечь реальный JSX кнопки «Отправить на ревью» из старого и   */
/* нового SelfReviewForm.tsx — целиком, тем же ts.JsxElement, что       */
/* стоит в файле. Мокать API и монтировать всю форму (auth + effects)   */
/* не нужно: пробе достаточно самого узла и трёх локальных переменных.  */
/* ------------------------------------------------------------------ */
function extractSubmitButtonJsx(source, label) {
  const sf = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = null;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === 'Button'
        && node.getText(sf).includes('Отправить на ревью')) {
      assert.equal(found, null, `${label}: больше одного Button с текстом «Отправить на ревью»`);
      found = node.getText(sf);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  assert.ok(found, `${label}: Button «Отправить на ревью» не найден`);
  return found;
}

const oldButtonJsx = extractSubmitButtonJsx(oldSrc('components/sprint/SelfReviewForm.tsx'), 'old-self-review-form.tsx');
const newButtonJsx = extractSubmitButtonJsx(curSrc('components/sprint/SelfReviewForm.tsx'), 'new-self-review-form.tsx');
assert.notEqual(oldButtonJsx, newButtonJsx, 'ожидалось изменение className между редакциями');

/* ------------------------------------------------------------------ */
/* Группа 3/4: литералы фокус-колец. Дедуп по строке класса, честно     */
/* помечено как фрагменты, а не страницы. Список фиксирован по          */
/* frontend/scripts/debt-audit.md и подтверждён построчной сверкой.     */
/* ------------------------------------------------------------------ */
const FOCUS_BASELINE = JSON.parse(oldRepoPath('frontend/scripts/one-focus-ring.baseline.json'));
const PERMANENT_KEEP = {
  'src/components/admin/NormPresetPicker.tsx': 1,
  'src/components/crm/CrmConnectWizard.tsx': 1,
  'src/components/settings/RopBonusSettings.tsx': 2,
  'src/components/settings/SettingsPresets.tsx': 1,
  'src/components/sprint/AddEntryForm.tsx': 1,
  'src/pages/SettingsPage.tsx': 2,
};
assert.equal(Object.values(PERMANENT_KEEP).reduce((a, b) => a + b, 0), 8);

const RING_TOKEN = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*ring-(?!offset|inset(?![\w-]))(?!\d+(?![\w-])|\[\d)(?:\[[^\]]+\]|\(--[^)]+\)|[a-z][a-z0-9-]*)(?:\/\d+)?/g;
const FOCUS_PREFIX = /^(?:[a-z][a-z0-9-]*:)*?(?:group-|peer-)?focus(?:-visible|-within)?:/;

/* Каждый литерал со своей строкой и порядковым номером на строке — так old и
   current сопоставляются позиционно, а не текстом: правка МЕНЯЕТ текст, но
   номер строки в этих файлах не сдвигался (правки — замена внутри тех же
   строк, что подтверждено построчным git diff перед этим прогоном). */
function literalsByLine(source, filename) {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const byLine = new Map();
  function visit(node) {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const order = (byLine.get(line)?.length) || 0;
      const list = byLine.get(line) || [];
      list.push({ line, order, text: node.text });
      byLine.set(line, list);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return byLine;
}

const removedRaw = []; // полный список всех focus-tied вхождений (для счёта, ожидается 84)
const permanentRaw = []; // все decorative вхождения (для счёта, ожидается 8)
for (const relFile of Object.keys(FOCUS_BASELINE.debt)) {
  const oldFileSrc = oldSrc(relFile.replace(/^src\//, ''));
  const curFileSrc = curSrc(relFile.replace(/^src\//, ''));
  const oldByLine = literalsByLine(oldFileSrc, relFile);
  const curByLine = literalsByLine(curFileSrc, relFile);
  for (const [line, entries] of oldByLine) {
    for (const entry of entries) {
      if (!RING_TOKEN.test(entry.text)) { RING_TOKEN.lastIndex = 0; continue; }
      RING_TOKEN.lastIndex = 0;
      const tokens = [...entry.text.matchAll(RING_TOKEN)].map((m) => m[0]);
      const anyFocusTied = tokens.some((t) => FOCUS_PREFIX.test(t));
      const anyDecorative = tokens.some((t) => !FOCUS_PREFIX.test(t));
      const curEntry = (curByLine.get(line) || [])[entry.order];
      const record = { file: relFile, line, order: entry.order, old: entry.text, current: curEntry ? curEntry.text : null };
      if (anyDecorative) permanentRaw.push(record);
      if (anyFocusTied) removedRaw.push(record);
    }
  }
}
assert.equal(removedRaw.length, 84, `ожидалось 84 focus-tied вхождения, найдено ${removedRaw.length}`);
assert.equal(permanentRaw.length, 8, `ожидалось 8 постоянных вхождений, найдено ${permanentRaw.length}`);
assert.ok(permanentRaw.every((p) => p.current !== null), 'у постоянного кольца пропал соответствующий литерал в текущем файле — сопоставление по строке разъехалось');
assert.ok(removedRaw.every((p) => p.current !== null), 'у удаляемого кольца пропал соответствующий литерал в текущем файле — сопоставление по строке разъехалось');

/* Для браузерного рендера дедуп по УНИКАЛЬНОМУ (old,current) допустим — так
   разрешено явно: список и счёт 84/8 уже подтверждены выше по полному набору,
   рендерим представителей, а не 84 одинаковых на вид фрагмента. */
function dedupBy(list, keyFn) {
  const seen = new Map();
  for (const item of list) { const k = keyFn(item); if (!seen.has(k)) seen.set(k, item); }
  return [...seen.values()];
}
/* Часть литералов — только ЦВЕТОВАЯ ветка (`error && '...focus:ring-danger-subtle'`),
   ширина кольца (ring-2) приходит из СОСЕДНЕГО литерала того же cn()-вызова
   (baseInput задаёт focus:ring-2, error-ветка только меняет focus:ring-<color>).
   В изоляции такая ветка не рисует видимый box-shadow — это честное свойство
   самого рецепта, не дефект фрагмента; видимая обводка для таких мест уже
   проверена на настоящих Input/Textarea/Select в группе 2. Для них проверка
   идёт по --tw-ring-color (не зависит от ширины, меняется ровно при
   присутствии/отсутствии локального focus:ring-*). */
const HAS_OWN_RING_WIDTH = /(?<![\w-])(?:[a-z][a-z0-9-]*:)*ring-(?:0|1|2|4|8)(?![\w-])/;
const removedList = dedupBy(removedRaw, (r) => r.old + ' ' + r.current).map((r) => ({
  file: r.file, line: r.line, old: r.old, expectedNew: r.current,
  colorOnlyBranch: !HAS_OWN_RING_WIDTH.test(r.old),
}));
const permanentList = permanentRaw.map((r) => ({ file: r.file, line: r.line, old: r.old, current: r.current }));
assert.equal(permanentList.length, 8);

/* ------------------------------------------------------------------ */
/* Сборка временной React-страницы внутри frontend/ (уборка в finally). */
/* ------------------------------------------------------------------ */
const scratch = mkdtempSync(join(frontend, 'debt-browser-scratch-'));
const chromeProfile = mkdtempSync(join(scratch, 'chrome-'));

function esc(s) { return JSON.stringify(s); }

writeFileSync(join(scratch, 'old-input.tsx'), oldSrc('components/ui/input.tsx'));
writeFileSync(join(scratch, 'index.html'),
  '<!doctype html><html><body><div id="root"></div><script type="module" src="./measure.tsx"></script></body></html>');

const oldProbeSrc = [
  "import {Button} from '@/components/ui/button';",
  "import {cn} from '@/lib/utils';",
  'export default function OldSubmitProbe() {',
  '  const canSubmit = true, submitting = false, handleSubmitClick = () => {};',
  '  return ' + oldButtonJsx + ';',
  '}',
].join('\n');
const newProbeSrc = oldProbeSrc.replace('OldSubmitProbe', 'NewSubmitProbe').replace(oldButtonJsx, newButtonJsx);
writeFileSync(join(scratch, 'old-submit-probe.tsx'), oldProbeSrc);
writeFileSync(join(scratch, 'new-submit-probe.tsx'), newProbeSrc);

const measureTsx = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import '@/index.css';
import OldSubmitProbe from './old-submit-probe';
import NewSubmitProbe from './new-submit-probe';
import {Input as OldInput, Textarea as OldTextarea, Select as OldSelect} from './old-input';
import {Input as NewInput, Textarea as NewTextarea, Select as NewSelect} from '@/components/ui/input';

const removed = ${JSON.stringify(removedList)};
const permanent = ${JSON.stringify(permanentList)};

const inputPairs = [
  ['Input:normal', <OldInput placeholder="x"/>, <NewInput placeholder="x"/>],
  ['Input:error', <OldInput placeholder="x" error/>, <NewInput placeholder="x" error/>],
  ['Textarea:normal', <OldTextarea placeholder="x"/>, <NewTextarea placeholder="x"/>],
  ['Textarea:error', <OldTextarea placeholder="x" error/>, <NewTextarea placeholder="x" error/>],
  ['Select:normal', <OldSelect><option>a</option></OldSelect>, <NewSelect><option>a</option></NewSelect>],
  ['Select:error', <OldSelect error><option>a</option></OldSelect>, <NewSelect error><option>a</option></NewSelect>],
];

createRoot(document.getElementById('root')).render(
  <div>
    {/* transition/animation отключены глобально: измерение снимает
        установившееся состояние сразу после focus(), без ожидания
        transition-all из реальных классов (ring/border/outline-color). */}
    <style>{'*, *::before, *::after { transition: none !important; animation: none !important; }'}</style>
    <section data-pair="submit-button" style={{display:'flex',gap:16}}>
      <div data-before><OldSubmitProbe/></div>
      <div data-after><NewSubmitProbe/></div>
    </section>
    {inputPairs.map(([name, before, after]) => (
      <section key={name} data-pair={name} style={{display:'flex',gap:16}}>
        <div data-before>{before}</div>
        <div data-after>{after}</div>
      </section>
    ))}
    {removed.map((r, i) => (
      <section key={'removed'+i} data-removed-old={r.old} data-removed-new={r.expectedNew} data-color-only={r.colorOnlyBranch ? '1' : '0'} style={{display:'flex',gap:16}}>
        <button className={r.old} data-role="old">фрагмент</button>
        <button className={r.expectedNew} data-role="new">фрагмент</button>
      </section>
    ))}
    {permanent.map((p, i) => (
      <section key={'permanent'+i} data-permanent-file={p.file} data-permanent-line={p.line} data-permanent-class={p.old} style={{display:'flex',gap:16}}>
        <button className={p.old} data-role="before">фрагмент</button>
        <button className={p.current} data-role="after">фрагмент</button>
      </section>
    ))}
  </div>
);

function rgbToHex(value) {
  const m = value.match(/[\\d.]+/g);
  if (!m) return null;
  return '#' + m.slice(0,3).map(c => Math.round(Number(c)).toString(16).padStart(2,'0')).join('').toUpperCase();
}
function luminance(hex) {
  const h = hex.replace('#','');
  const chans = [0,2,4].map(i => parseInt(h.slice(i,i+2),16)/255).map(c => c<=.03928 ? c/12.92 : ((c+.055)/1.055)**2.4);
  return chans[0]*.2126 + chans[1]*.7152 + chans[2]*.0722;
}
function contrast(hexA, hexB) {
  const a = luminance(hexA), b = luminance(hexB);
  return (Math.max(a,b)+.05) / (Math.min(a,b)+.05);
}
function composited(el, bgProp) {
  const s = getComputedStyle(el);
  const parent = el.parentElement;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = parent ? getComputedStyle(parent).backgroundColor : '#FFFFFF'; ctx.fillRect(0,0,1,1);
  ctx.fillStyle = s[bgProp]; ctx.fillRect(0,0,1,1);
  const rgb = [...ctx.getImageData(0,0,1,1).data].slice(0,3);
  return 'rgb(' + rgb.join(', ') + ')';
}
function box(el) {
  const s = getComputedStyle(el), r = el.getBoundingClientRect();
  return {width:r.width, height:r.height, padding:s.padding, fontSize:s.fontSize, lineHeight:s.lineHeight, borderWidth:s.borderWidth, borderRadius:s.borderRadius};
}
/* Стили читаются НАПРЯМУЮ с реального узла (второй аргумент getComputedStyle
   годится только для настоящих псевдо-ЭЛЕМЕНТОВ вроде ::before, не для
   псевдо-КЛАССА :focus-visible). Модальность клавиатуры доказывается один раз
   реальным Tab через CDP до вызова этой функции; el.focus() дальше наследует
   её, а el.matches(':focus-visible') подтверждает это на каждом узле. */
function readVisualState(el) {
  const s = getComputedStyle(el);
  return {boxShadow: s.boxShadow, outline: s.outline, outlineColor: s.outlineColor, outlineWidth: s.outlineWidth, outlineStyle: s.outlineStyle, outlineOffset: s.outlineOffset, twRingColor: s.getPropertyValue('--tw-ring-color') || null};
}
function asButton(el, where) {
  if (!el || el.tagName !== 'BUTTON') throw new Error('expected BUTTON at ' + where + ', got ' + (el ? el.tagName : 'null'));
  return el;
}
function idleAndFocused(el) {
  el.blur();
  const idle = readVisualState(el);
  el.focus();
  const isFocusVisible = el.matches(':focus-visible');
  const focused = readVisualState(el);
  const geometry = box(el);
  el.blur();
  return {idle, focused, isFocusVisible, box: geometry};
}
window.debtProbe = {
  submitButton: () => {
    const before = asButton(document.querySelector('[data-pair="submit-button"] [data-before] button'), 'submit-button/before');
    const after = asButton(document.querySelector('[data-pair="submit-button"] [data-after] button'), 'submit-button/after');
    const bg = (el) => composited(el, 'backgroundColor');
    return {
      before: {bgHex: rgbToHex(bg(before)), fgHex: rgbToHex(getComputedStyle(before).color), box: box(before), text: before.textContent},
      after: {bgHex: rgbToHex(bg(after)), fgHex: rgbToHex(getComputedStyle(after).color), box: box(after), text: after.textContent},
    };
  },
  inputPairs: () => [...document.querySelectorAll('[data-pair]')]
    .filter(el => el.dataset.pair !== 'submit-button')
    .map(el => {
      const before = el.querySelector('[data-before] input, [data-before] textarea, [data-before] select');
      const after = el.querySelector('[data-after] input, [data-after] textarea, [data-after] select');
      return {name: el.dataset.pair, before: idleAndFocused(before), after: idleAndFocused(after)};
    }),
  removedFragments: () => [...document.querySelectorAll('[data-removed-old]')].map(el => {
    const before = el.querySelector('button[data-role="old"]');
    const after = el.querySelector('button[data-role="new"]');
    return {oldClass: el.dataset.removedOld, newClass: el.dataset.removedNew, colorOnlyBranch: el.dataset.colorOnly === '1', before: idleAndFocused(before), after: idleAndFocused(after)};
  }),
  permanentFragments: () => [...document.querySelectorAll('[data-permanent-class]')].map(el => {
    const before = el.querySelector('button[data-role="before"]');
    const after = el.querySelector('button[data-role="after"]');
    return {file: el.dataset.permanentFile, line: Number(el.dataset.permanentLine), className: el.dataset.permanentClass, before: idleAndFocused(before), after: idleAndFocused(after)};
  }),
  contrast,
  ready: () => !!document.querySelector('[data-pair="submit-button"] [data-after] button'),
};
`;
writeFileSync(join(scratch, 'measure.tsx'), measureTsx);

let server;
let chrome;
let socket;
let rpc;
const result = {
  baseline: BASELINE, capturedAt: new Date().toISOString(),
  sourceHashes: Object.fromEntries([...new Set([
    ...Object.keys(FOCUS_BASELINE.debt).map(p => p.replace(/^src\//, '')),
    'components/sprint/SelfReviewForm.tsx', 'components/ui/button.tsx', 'index.css',
  ])].map(p => [p, createHash('sha256').update(curSrc(p)).digest('hex')])),
  groups: {},
};
try {
  server = await createServer({ root: frontend, configFile: join(frontend, 'vite.config.ts'), server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  const url = `http://127.0.0.1:${address.port}/${scratch.split('/').pop()}/index.html`;

  chrome = spawn(CHROME, [
    '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    `--user-data-dir=${chromeProfile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Chrome startup timeout')), 20000);
    chrome.stderr.on('data', (data) => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); res(match[1]); }
    });
    chrome.on('error', rej);
  });
  socket = new WebSocket(wsUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });
  let sequence = 0; const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const p = pending.get(message.id);
    if (p) { pending.delete(message.id); clearTimeout(p.timer); message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result); }
  };
  rpc = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); rej(new Error(method + ' timeout')); }, 20000);
    pending.set(id, { resolve: res, reject: rej, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await rpc('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await rpc('Target.attachToTarget', { targetId, flatten: true });
  const evaluate = async (expression) => {
    const value = await rpc('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    assert.ok(!value.exceptionDetails, JSON.stringify(value.exceptionDetails));
    return value.result.value;
  };
  await rpc('Page.enable', {}, sessionId);
  await rpc('Page.navigate', { url }, sessionId);
  await evaluate(`new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(window.debtProbe?.ready()){clearInterval(timer);resolve(true);}else if(Date.now()-start>15000){clearInterval(timer);reject(new Error('Probe did not render'));}},50);})`);
  await evaluate('document.fonts.ready.then(()=>true)');

  /* Реальный Tab через CDP (Input domain, а не programmatic dispatchEvent из
     страницы) один раз на документ — доказывает клавиатурную модальность.
     Chromium держит "последний способ ввода" на уровне документа, поэтому
     последующие el.focus() из JS дают настоящий :focus-visible = true;
     это проверяется на каждом узле el.matches(':focus-visible') ниже, а не
     предполагается. */
  await rpc('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
  await rpc('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);

  /* --- Группа 1: реальная кнопка --- */
  const submit = await evaluate('window.debtProbe.submitButton()');
  submit.before.contrast = await evaluate(`window.debtProbe.contrast(${esc(submit.before.bgHex)}, ${esc(submit.before.fgHex)})`);
  submit.after.contrast = await evaluate(`window.debtProbe.contrast(${esc(submit.after.bgHex)}, ${esc(submit.after.fgHex)})`);
  result.groups.submitButton = {
    описание: 'SelfReviewForm.tsx, реальный Button+cn, canSubmit=true submitting=false, AST-извлечение JSX',
    ...submit,
  };

  /* --- Группа 2: Input/Textarea/Select --- */
  const inputPairs = await evaluate('window.debtProbe.inputPairs()');
  result.groups.inputPairs = { описание: 'старый vs новый input.tsx, реальные Input/Textarea/Select, normal и error', pairs: inputPairs };

  /* --- Группа 3: 84 удалённых, для рендера дедуп по уникальному литералу --- */
  const removedFragments = await evaluate('window.debtProbe.removedFragments()');
  result.groups.removedFocusRings = {
    описание: `изолированные фрагменты (не страницы): ${removedList.length} уникальных литералов, покрывающих все ${removedRaw.length} focus-tied вхождений из 84; before = реальный литерал из ${BASELINE}, after = соответствующий литерал ИЗ ТЕКУЩЕГО src (сопоставлено по строке+порядку в AST, не пересчитано регэкспом)`,
    уникальных_литералов: removedList.length,
    охватывает_вхождений_из_84: removedRaw.length,
    все_84_вхождения: removedRaw.map((r) => ({ file: r.file, line: r.line })),
    fragments: removedFragments,
  };

  /* --- Группа 4: 8 постоянных, каждое по своей строке (не дедуп) --- */
  const permanentFragments = await evaluate('window.debtProbe.permanentFragments()');
  result.groups.permanentRings = {
    описание: 'все 8 сохранённых постоянных колец (не фокус), каждое своей строкой: computed boxShadow idle-состояния (без фокуса) до и после должен совпадать',
    fragments: permanentFragments,
  };

  result.browser = execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim();

  /* --- Сверка ожиданий на живых числах, без досрочного "готово" --- */
  const outlineIsGlobal = (state) => /rgb\(119,\s*55,\s*6\)/.test(state.outlineColor) && state.outlineWidth === '2px' && state.outlineOffset === '2px' && state.outlineStyle === 'solid';
  const checks = [];
  checks.push({ name: 'submit-button: contrast 2.28 -> 5.02 (±0.06)', pass: Math.abs(submit.before.contrast - 2.28) < 0.06 && Math.abs(submit.after.contrast - 5.02) < 0.06, before: submit.before.contrast, after: submit.after.contrast });
  checks.push({ name: 'submit-button: bg hex #22C55E -> #15803D', pass: submit.before.bgHex === '#22C55E' && submit.after.bgHex === '#15803D', before: submit.before.bgHex, after: submit.after.bgHex });
  checks.push({ name: 'submit-button: identical box geometry', pass: JSON.stringify(submit.before.box) === JSON.stringify(submit.after.box) });

  for (const p of inputPairs) {
    checks.push({ name: `${p.name}: geometry unchanged old vs new`, pass: JSON.stringify(p.before.box) === JSON.stringify(p.after.box) });
    checks.push({ name: `${p.name}: keyboard modality proven (before)`, pass: p.before.isFocusVisible === true });
    checks.push({ name: `${p.name}: keyboard modality proven (after)`, pass: p.after.isFocusVisible === true });
    checks.push({ name: `${p.name}: old — focus changed local boxShadow vs idle`, pass: p.before.focused.boxShadow !== p.before.idle.boxShadow });
    checks.push({ name: `${p.name}: new — focus does NOT change local boxShadow vs idle (no local ring left)`, pass: p.after.focused.boxShadow === p.after.idle.boxShadow });
    checks.push({ name: `${p.name}: new — global outline #773706 2px offset 2px on focus`, pass: outlineIsGlobal(p.after.focused) });
  }

  for (const [index, f] of removedFragments.entries()) {
    const tag = String(index + 1);
    checks.push({ name: `removed[${tag}]: geometry unchanged`, pass: JSON.stringify(f.before.box) === JSON.stringify(f.after.box) });
    checks.push({ name: `removed[${tag}]: keyboard modality proven (before)`, pass: f.before.isFocusVisible === true });
    checks.push({ name: `removed[${tag}]: keyboard modality proven (after)`, pass: f.after.isFocusVisible === true });
    checks.push({ name: `removed[${tag}]: old — focus changed ${f.colorOnlyBranch ? 'ring color (width comes from a separate recipe)' : 'local boxShadow'} vs idle`, pass: f.colorOnlyBranch
      ? f.before.focused.twRingColor !== f.before.idle.twRingColor
      : f.before.focused.boxShadow !== f.before.idle.boxShadow });
    checks.push({ name: `removed[${tag}]: new — focus does NOT change local boxShadow vs idle`, pass: f.after.focused.boxShadow === f.after.idle.boxShadow });
    checks.push({ name: `removed[${tag}]: new — global outline #773706 2px offset 2px on focus`, pass: outlineIsGlobal(f.after.focused) });
  }

  for (const p of permanentFragments) {
    const tag = `${p.file}:${p.line}`;
    checks.push({ name: `permanent[${tag}]: idle boxShadow unchanged old vs new (decorative ring preserved)`, pass: p.before.idle.boxShadow === p.after.idle.boxShadow });
    checks.push({ name: `permanent[${tag}]: geometry unchanged old vs new`, pass: JSON.stringify(p.before.box) === JSON.stringify(p.after.box) });
  }

  result.checks = checks;
  result.summary = { total: checks.length, passed: checks.filter((c) => c.pass).length, failed: checks.filter((c) => !c.pass).map((c) => c.name) };
  if (result.summary.failed.length) process.exitCode = 1;

  writeFileSync(join(here, 'debt-browser-results.json'), JSON.stringify(result, null, 1) + '\n');
  console.log(`итог: ${result.summary.passed}/${result.summary.total} проверок прошли`);
  if (result.summary.failed.length) console.log('провалено:', JSON.stringify(result.summary.failed, null, 1));
} catch (error) {
  process.exitCode = 1;
  console.error('ошибка прогона:', error.stack || error.message);
} finally {
  if (socket?.readyState === WebSocket.OPEN) { await rpc?.('Browser.close').catch(() => {}); socket.close(); }
  if (chrome && chrome.exitCode === null) { chrome.kill(); await new Promise((res) => chrome.once('exit', res)); }
  await server?.close();
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
