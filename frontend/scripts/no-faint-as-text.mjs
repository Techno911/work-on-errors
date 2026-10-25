#!/usr/bin/env node
/**
 * ЗАМОК: светлый серый не бывает текстом.
 *
 * ПОВОД. Бриф этапа 2: «значения светлее приглушённого на светлом фоне
 * запрещены, они не дают контраст 4,5. Все места, где сейчас стоит #9CA3AF,
 * #A6A09B, #A8A29E как ТЕКСТ, переезжают на приглушённый; как иконка или
 * разделитель могут остаться».
 *
 *   #A6A09B (fg-faint) на белом  2,59:1  — норму не проходит
 *   #D6D3D1 (fg-decor) на белом  1,53:1  — норму не проходит
 *   #78716C (fg-subtle) на белом 4,80:1  — проходит
 *
 * Шаг 3 перевёл 248 таких мест, но перевод сам по себе ничего не стережёт:
 * одно место всё равно осталось, потому что роль там бралась не классом, а
 * ИНЛАЙНОВЫМ стилем через var(), где класса нет вовсе. Именно так KPI карточки
 * премии печатал «–» цветом 2,59:1. Замок смотрит обе формы.
 *
 * ЧТО РАЗРЕШЕНО. Значок и черта: `fg-faint` и `fg-decor` для того и заведены.
 * Значком считается тег с заглавной буквы (компонент lucide-react) в той же
 * строке. Разделителем — свойство, которое не красит текст: `border`,
 * `background`, `fill`, `stroke`.
 *
 * ЗАПУСК:
 *   node no-faint-as-text.mjs             проверить
 *   node no-faint-as-text.mjs --selftest  самопроверка сломом
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect, verdict, selftest, args } from './gate-shared.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { selftest: doSelftest, srcArg } = args();
const ROOT = srcArg || join(HERE, '..', 'src');

const КЛАСС = /(?<![\w-])text-(fg-faint|fg-decor)(?![\w-])/g;
/* Инлайновый стиль: роль как ЦВЕТ ТЕКСТА. `borderRight`, `backgroundColor`,
   `fill` и `stroke` этой ролью красить можно, это и есть черта и значок. */
const ИНЛАЙН = /(?<![\w-])color:\s*(?:'|")?var\(--color-(fg-faint|fg-decor)\)/g;

/** Тег, в списке атрибутов которого стоит класс, в пределах строки. */
function тегСлева(line, pos) {
  const i = line.lastIndexOf('<', pos);
  if (i < 0) return '';
  const m = /^<([A-Za-z][\w.]*)/.exec(line.slice(i));
  if (!m) return '';
  return line.slice(i, pos).includes('>') ? '' : m[1];
}

/* Четыре исключения, каждое проверяемое, а не «на глаз». Все они прямо
   разрешены брифом («как иконка или разделитель могут остаться») либо самим
   стандартом доступности (неактивный контрол из проверки исключён, WCAG 1.4.3).
   Пятого исключения быть не должно: каждое новое — повод к разговору, а не
   строка в этом файле. */
const ЗНАЧОК_РАЗМЕР = /(?<![\w-])w-\d[\d./]*(?![\w-])/;
const ЗНАЧОК_ВЫСОТА = /(?<![\w-])h-\d[\d./]*(?![\w-])/;
const ПОЛЯ = /(?<![\w-])p[xy]?-[\d.]+(?![\w-])/;
const КЕГЛЬ = /(?<![\w-])text-(?:caption|dense|body|h[123])(?![\w-])/;
const НЕАКТИВЕН = /(?<![\w-])cursor-not-allowed(?![\w-])/;

function можно(line, cls, тег) {
  if (тег && /^[A-Z]/.test(тег)) return 'значок lucide-react';
  if (ЗНАЧОК_РАЗМЕР.test(cls) && ЗНАЧОК_ВЫСОТА.test(cls)) return 'значок по размеру';
  if (ПОЛЯ.test(cls) && !КЕГЛЬ.test(cls)) return 'кнопка-значок';
  if (НЕАКТИВЕН.test(cls)) return 'неактивный контрол';
  if (/>\u00B7</.test(line)) return 'разделитель · ';
  return null;
}

function find(line) {
  const out = [];
  for (const m of line.matchAll(КЛАСС)) {
    const тег = тегСлева(line, m.index);
    const кав = line.lastIndexOf('"', m.index);
    const кон = line.indexOf('"', m.index);
    const cls = кав >= 0 && кон > m.index ? line.slice(кав + 1, кон) : line;
    if (можно(line, cls, тег)) continue;
    out.push(`светлый серый как текст: text-${m[1]}`);
  }
  for (const m of line.matchAll(ИНЛАЙН)) {
    out.push(`светлый серый как цвет текста в инлайновом стиле: ${m[1]}`);
  }
  return out;
}

if (doSelftest) {
  process.exit(selftest({
    name: 'no-faint-as-text',
    find,
    dirty: [
      'export const A = () => (',
      '  <div>',
      '    <p className="text-caption text-fg-faint">подпись</p>',
      '    <span style={{ color: \'var(--color-fg-faint)\' }}>–</span>',
      '    <b className="text-fg-decor">итог</b>',
      '  </div>',
      ');',
    ].join('\n'),
    /* Чистый файл: значок с той же ролью, черта и подложка через var(),
       текст на приглушённом, и запрещённое сочетание в комментарии. */
    clean: [
      '// было text-fg-faint, стало text-fg-subtle',
      'export const B = () => (',
      '  <div>',
      '    <ChevronDown className="w-4 h-4 text-fg-faint" />',
      '    <p className="text-caption text-fg-subtle">подпись</p>',
      '    <span style={{ borderRight: \'2px dashed var(--color-fg-faint)\' }} />',
      '    <span style={{ backgroundColor: \'var(--color-fg-faint)\' }} />',
      '  </div>',
      ');',
    ].join('\n'),
  }));
}

const { perFile, hits } = collect({ root: ROOT, find });
process.exit(verdict({
  name: 'no-faint-as-text',
  rule: 'fg-faint и fg-decor — значок и черта, текстом они быть не могут',
  cure: 'Возьмите text-fg-subtle (#78716C, 4,80:1) — это нижняя граница ' +
        'шкалы для текста. Если это действительно значок или разделитель, ' +
        'он должен стоять на компоненте значка или красить не текст.',
  baselinePath: join(HERE, 'no-faint-as-text.baseline.json'),
  perFile, hits, refresh: false,
}));
