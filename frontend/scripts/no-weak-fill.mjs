#!/usr/bin/env node
/**
 * ЗАМОК: success/warning как ЗАЛИВКА без подписи запрещены.
 *
 * ПОВОД. 14.09.2026, разбор владельца по дефекту фокусного кольца. Роли
 * `--color-success` (#22C55E) и `--color-warning` (#EAB308) документированы
 * в index.css как «точка, полоса, индикатор» — нетекстовая графика с нормой
 * WCAG 1.4.11 (≥3:1). На светлых поверхностях они дают 2,09–2,28 и
 * 1,76–1,92 — норму не проходят. Найдены два места, где это било по делу:
 * заливка прогресс-бара в ProgressIndicator.tsx (allDone) и в DashboardPage.tsx
 * (pct === 100), обе без подписи рядом — только сама полоса. Обе переведены
 * на `success-fg` (#15803D, ≥4,5:1 на всех поверхностях), а вместе с ними —
 * значок FirstStepsCard.tsx (чек-лист без подписи состояния, только имя шага).
 *
 * ПОЧЕМУ ГРАНИЦА ИМЕННО ЗДЕСЬ. Значок с ТЕКСТОВОЙ ПОДПИСЬЮ рядом (кнопка
 * «Скопировано», плашка с текстом «Отстаёт», алерт с текстом предупреждения)
 * декоративен: смысл несёт видимый текст, а цвет значка — только усиление.
 * Таких мест на платформе 14, они разобраны владельцем поимённо и НЕ входят
 * в замок: `text-success`/`text-warning` остаются разрешены. А вот ЗАЛИВКА
 * (`bg-success`/`bg-warning`) почти никогда не бывает декоративной — полоса,
 * дорожка и точка состояния сами являются единственным визуальным сигналом,
 * поэтому запрещены категорически, без списка допустимых мест.
 *
 * ЧТО РАЗРЕШЕНО. `-fg`, `-subtle`, `-muted`, `-solid` — уже проверенные
 * ролями contrast-эквиваленты; сам bg- с суффиксом не запрещён.
 *
 * ЗАПУСК:
 *   node no-weak-fill.mjs             проверить
 *   node no-weak-fill.mjs --selftest  самопроверка сломом
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, verdict, selftest, args } from './gate-shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { selftest: doSelftest, srcArg } = args();
const ROOT = srcArg || join(HERE, '..', 'src');

/* bg-success / bg-warning ровно (без суффикса), в т.ч. с состояниями
   (hover:, active: и т.п.) и произвольными модификаторами через двоеточие. */
const ЗАЛИВКА = /(?<![\w-])(?:[\w-]+:)*bg-(success|warning)(?![\w-])/g;

function find(line) {
  const out = [];
  for (const m of line.matchAll(ЗАЛИВКА)) {
    out.push(`заливка без подписи цветом ${m[1]}: bg-${m[1]}`);
  }
  return out;
}

if (doSelftest) {
  process.exit(selftest({
    name: 'no-weak-fill',
    find,
    dirty: [
      'export const A = () => (',
      '  <div className={`h-full rounded-full ${allDone ? "bg-success animate-pulse" : "bg-surface-sunken"}`} />',
      ');',
    ].join('\n'),
    /* Чистый файл: правильная роль -fg, декоративный текст-значок с подписью
       рядом (разрешён), и упоминание в комментарии. */
    clean: [
      '// не пиши className="bg-success"',
      'export const B = () => (',
      '  <div>',
      '    <div className="h-full rounded-full bg-success-fg" />',
      '    <CheckCircle2 className="w-4 h-4 text-success" />',
      '    <span>Отстаёт</span>',
      '  </div>',
      ');',
    ].join('\n'),
  }));
}

const { perFile, hits } = collect({ root: ROOT, find });
process.exit(verdict({
  name: 'no-weak-fill',
  rule: 'success/warning заливкой без подписи не проходят WCAG 1.4.11 (≥3:1) — используйте success-fg/warning-fg',
  cure: 'Возьмите success-fg (#15803D) или warning-fg (#A16207) — они уже проходят норму на всех поверхностях.',
  baselinePath: join(HERE, 'no-weak-fill.baseline.json'),
  perFile, hits, refresh: false,
}));
