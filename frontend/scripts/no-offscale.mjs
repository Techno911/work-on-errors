#!/usr/bin/env node
/**
 * ЗАМОК: кегль, скругление и тень берутся из шкалы системы, а не из ступени
 * чужой библиотеки и не из произвольного числа.
 *
 * ПОВОД. До шага 3 платформа держала восемь ступеней кегля Tailwind плюс шесть
 * произвольных записей в пикселях, восемь ступеней радиуса и шесть ступеней
 * тени. Хуже того, половина шкалы радиуса была ПЕРЕОПРЕДЕЛЕНА: `rounded-lg`
 * давал 16 при штатных 8, а `rounded-xl` остался штатным 12 — то есть «lg»
 * было крупнее «xl», и человек, дописывая экран, брал скругление наугад.
 * Шаг 3 свёл всё к трём коротким шкалам, названным работой, а не размером.
 *
 * ЧТО ЗАПРЕЩЕНО. Ступени Tailwind (text-xs…text-4xl, rounded-sm…rounded-3xl,
 * shadow-sm…shadow-2xl) и произвольная запись в квадратных скобках
 * (text-[13px], rounded-[10px], shadow-[0_1px_2px…]).
 *
 * ЧТО РАЗРЕШЕНО. Роли шкалы:
 *   кегль      text-caption 12 · text-dense 13 · text-body 15 ·
 *              text-h3 18 · text-h2 22 · text-h1 26
 *   радиус     rounded-chip 4 · rounded-control 10 · rounded-nested 12 ·
 *              rounded-card 16 · rounded-full (пилюля)
 *   тень       shadow-raised · shadow-float · shadow-overlay
 * Значения лежат в одном месте — `src/index.css`, собирается из
 * «07 Внедрение/ro/_скрипты/карта-ролей.py».
 *
 * ПОЧЕМУ БЕЗ СНИМКА ДОЛГА. Долг здесь нулевой: шаг 3 перевёл все 1988 мест
 * (1274 кегля, 653 радиуса, 61 тень) одним прогоном. Замок с самого начала
 * работает обычным запретом, снимать нечего.
 *
 * ЗАПУСК:
 *   node no-offscale.mjs                проверить
 *   node no-offscale.mjs --selftest     самопроверка сломом
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, selftest, args } from './gate-shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { selftest: doSelftest, srcArg } = args();
const ROOT = srcArg || join(HERE, '..', 'src');

/* Ступени чужих шкал. Хвостовой (?![\w-]) вместо \b намеренно: дефис не
   словесный символ, поэтому \b совпал бы внутри `text-sm-something`, а
   главное — не отличил бы `shadow-lg` от нашего `shadow-float`. */
const ПРАВИЛА = [
  [/(?<![\w-])text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl|7xl)(?![\w-])/g,
   'ступень кегля Tailwind'],
  [/(?<![\w-])text-\[[0-9.]+(?:px|rem|em)\]/g,
   'кегль числом'],
  [/(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br|s|e|ss|se|es|ee))?-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)(?![\w-])/g,
   'ступень радиуса Tailwind'],
  [/(?<![\w-])rounded(?:-(?:t|b|l|r|tl|tr|bl|br))?-\[[^\]]+\]/g,
   'радиус числом'],
  [/(?<![\w-])shadow-(?:xs|sm|md|lg|xl|2xl|inner)(?![\w-])/g,
   'ступень тени Tailwind'],
  [/(?<![\w-])shadow-\[[^\]]+\]/g,
   'тень числом'],
];

/* Смотрим только содержимое className: иначе в счёт попадает соседний текст
   строки, где «text-sm» могло встретиться в подписи или в адресе. */
function find(line) {
  const out = [];
  for (const m of line.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|'([^']*)')|'([^']*)'|"([^"]*)"/g)) {
    const cls = m[1] || m[2] || m[3] || m[4] || m[5] || '';
    if (!cls) continue;
    for (const [re, что] of ПРАВИЛА) {
      for (const hit of cls.matchAll(re)) out.push(`${что}: ${hit[0]}`);
    }
  }
  return out;
}

if (doSelftest) {
  process.exit(selftest({
    name: 'no-offscale',
    find,
    dirty: [
      'export const A = () => (',
      '  <div className="text-sm rounded-lg shadow-sm">',
      '    <span className="text-[13px] rounded-[10px] shadow-[0_1px_2px_rgba(0,0,0,.06)]" />',
      '    <span className={`text-2xl rounded-t-xl`} />',
      '  </div>',
      ');',
    ].join('\n'),
    /* Чистый файл: только роли шкалы, пилюля, запрещённые имена в комментарии
       и слово text-sm внутри обычного текста, а не класса. */
    clean: [
      '// было text-sm rounded-lg shadow-sm, стало text-dense rounded-card shadow-raised',
      'export const B = () => (',
      '  <div className="text-dense rounded-card shadow-raised">',
      '    <span className="text-caption rounded-full" />',
      '    <span className="text-h2 rounded-control shadow-overlay" />',
      '    <p className="text-body rounded-nested shadow-float">размер задаёт шкала</p>',
      '  </div>',
      ');',
    ].join('\n'),
  }));
}

const { hits } = collect({ root: ROOT, find });
console.log(`${hits.length ? '✗' : '✓'} no-offscale: ${hits.length} нарушений шкалы; допуска долга нет`);
for (const hit of hits) console.error(`  ${hit}`);
process.exit(hits.length ? 1 : 0);
