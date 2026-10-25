#!/usr/bin/env node
/**
 * Гейт версии платформы. Единственный источник версии в UI — frontend/package.json,
 * компоненты читают её через __APP_VERSION__ (vite define). Этот гейт гарантирует, что
 * версия НИКОГДА не разойдётся и не уйдёт в неверный формат — даже в свежей сессии:
 *
 *   1. номер принадлежит действующей схеме ЧиП (обе её фазы, см. ниже);
 *   2. носители версии не разъехались (frontend/backend/корневой package.json);
 *   3. в UI-файлах (AppLayout, LoginPage) запрещён хардкод версии — только __APP_VERSION__.
 *      Это убивает дрейф «поправил в одном месте, забыл в двух».
 *
 * СХЕМА (правило _ATLAS/СИСТЕМА.md §6, решение владельца 29.07.2026):
 *   фаза 1 — X.Y.Z, каждый разряд ОДНА цифра, потолок 9.9.9;
 *   фаза 2 — после 9.9.z НАВСЕГДА линия 1.MINOR.PATCH: первая цифра 1 не меняется больше
 *            никогда, MINOR стартует ровно с 10 и растёт без ограничений, PATCH — фиксы.
 *   Мажора после переезда нет: крупное обозначается текстом в CHANGELOG и окном «Что нового».
 *
 * Почему переписано 07.08.2026. Прежняя редакция знала ТОЛЬКО фазу 1: регулярка
 * /^\d\.\d\.\d$/ и подсказка «при превышении 9 бампай старший разряд». Платформа шла на
 * 8.0.0, то есть переезд был близко, и в день перехода сборка упала бы на своём же замке —
 * а свежая сессия в такой ситуации либо снимает замок, либо нарушает правило владельца.
 * Замок, который валит ЗАКОННЫЙ ход, вреднее отсутствующего: он учит себя обходить.
 *
 * Знание схемы здесь ДУБЛИРУЕТСЯ (питоновский замок Атласа в контейнер сборки не попадает).
 * Чтобы копия не разошлась с оригиналом, есть сторож: `check_version.py --audit-guards`
 * обходит дерево и валит любой скрипт платформы, знающий только старую фазу.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (msg) => { console.error(`✗ version-sync: ${msg}`); process.exit(1); };

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
const version = pkg.version;

// 1. Номер принадлежит одной из двух фаз схемы.
const m = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
if (!m) {
  fail(`package.json version = «${version}» — нужен формат X.Y.Z без ведущих нулей.`);
}
const [major, minor, patch] = m.slice(1).map(Number);
const isNewLine = major === 1 && minor >= 10;
const isOldLine = major <= 9 && minor <= 9 && patch <= 9;
if (!isNewLine && !isOldLine) {
  fail(`package.json version = «${version}» не принадлежит ни одной фазе схемы ЧиП. `
     + `До переезда каждый разряд одна цифра (потолок 9.9.9); после переезда линия `
     + `1.MINOR.PATCH с минором от 10. Правило — _ATLAS/СИСТЕМА.md §6.`);
}

// 2. Носители версии не разъехались. До 07.08.2026 backend/package.json жил на 1.0.0, а
//    корневой на 0.0.0 при боевой 8.0.0 — три разных ответа на вопрос «какая это версия».
//    В UI это не видно, поэтому и не всплывало; общий замок Атласа считает такое нарушением.
//
//    ⚠️ Соседей может физически не быть: образ фронта собирается из контекста ./frontend,
//    и корневой с бэкендовым package.json туда не копируются. Прежняя редакция читала их
//    безусловно и роняла КАЖДУЮ докер-сборку с ENOENT — то есть замок, поставленный ради
//    надёжности, сделал невозможным сам выкат, и это не всплывало двое суток, потому что
//    локальная сборка проходит (файлы на месте), а деплой с 07.08.2026 не запускали.
//    Проверка не ослаблена, а перенесена туда, где носители существуют: scripts/deploy.sh
//    сверяет их перед пушем, до всякого докера.
let neighboursChecked = 0;
for (const rel of ['../backend/package.json', '../package.json']) {
  let raw;
  try {
    raw = readFileSync(join(ROOT, rel), 'utf-8');
  } catch (err) {
    if (err.code === 'ENOENT') continue; // контекст сборки образа: соседа тут нет
    throw err;
  }
  neighboursChecked++;
  const other = JSON.parse(raw).version;
  if (other !== version) {
    fail(`${rel}: версия «${other}» ≠ frontend/package.json «${version}». `
       + `Носители версии платформы обязаны совпадать.`);
  }
}

// 3. Хардкод версии в UI-файлах запрещён — только __APP_VERSION__.
//    Регулярка терпит ЛЮБОЕ число цифр в разряде: прежняя /v\d\.\d\.\d/ после переезда
//    перестала бы видеть «v1.10.0», то есть ослепла бы ровно там, где нужнее всего.
const UI_FILES = ['src/components/layout/AppLayout.tsx', 'src/pages/LoginPage.tsx'];
const HARDCODED = /v\d+\.\d+\.\d+/;
for (const rel of UI_FILES) {
  const text = readFileSync(join(ROOT, rel), 'utf-8');
  if (HARDCODED.test(text)) {
    fail(`${rel}: хардкод версии «${text.match(HARDCODED)[0]}». Используй {__APP_VERSION__} `
       + `(единый источник — package.json).`);
  }
  if (!text.includes('__APP_VERSION__')) {
    fail(`${rel}: версия не выводится через __APP_VERSION__ — проверь, что строка версии на месте.`);
  }
}

const phase = isNewLine ? 'новая линия 1.MINOR.PATCH' : 'до переезда, потолок 9.9.9';
const neighbours = neighboursChecked === 2
  ? 'носители синхронны'
  : `носители не проверены здесь (${neighboursChecked} из 2 доступны: сборка образа), сверка в deploy.sh`;
console.log(`✓ version-sync: v${version} (${phase}; ${neighbours})`);
