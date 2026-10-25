#!/usr/bin/env node
// Замок канона оболочки платформ ЧиП 1.1 (разделы 1-10 оболочка, 11-13 вход, вкладка, карточка).
// Канон: «Дизайн-система платформ/08 Общие элементы/КАНОН-ОБОЛОЧКИ.md».
// Один и тот же файл лежит во всех платформах; что именно читать, говорит
// оболочка-канон.json рядом с ним. Мера строится на САМОМ предмете: скрипт читает
// исходники оболочки, а не документацию о них.
//
// Запуск:  node gate/оболочка-канон.mjs --конфиг scripts/оболочка-канон.json
// Слом:    node gate/оболочка-канон.mjs --selftest   (каждое правило обязано краснеть)
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ЗДЕСЬ = dirname(fileURLToPath(import.meta.url));
const САМОТЕСТ = process.argv.includes('--selftest');

const БЕЗ_ЦВЕТА = /#[0-9a-fA-F]{3,8}\b/g;
const РАСТР = /<img[^>]+src=["'{][^>]*\.(png|jpe?g|webp)/i;

// Каждое правило: имя, что читает, чем меряет. Возвращает список нарушений с адресом.
const ПРАВИЛА = [
  {
    имя: 'ширина панели задана переменной, а не числом',
    файлы: 'оболочка',
    проверка(текст, путь, конфиг) {
      if (пакетнаяОболочкаAppShell(конфиг)) return [];
      const беды = [];
      const переменная = new RegExp(конфиг.переменнаяШирины.replace(/[-]/g, '\\-'));
      const естьПеременная = конфиг.файлы.стили.some(ф => переменная.test(читать(конфиг, ф)));
      if (!естьПеременная) беды.push(`${конфиг.файлы.стили[0]}: не объявлена ${конфиг.переменнаяШирины}`);
      строки(текст).forEach(([н, с]) => {
        if (/(width|w-)\s*[:=]?\s*['"{]?\s*(240|64)\s*(px|['"}]|,|;|$)/.test(с) && !с.includes('var(') && !/\/\//.test(с.trim().slice(0, 2)))
          беды.push(`${путь}:${н}: ширина панели числом (${с.trim().slice(0, 60)})`);
      });
      return беды;
    },
  },
  {
    имя: 'выбор «свернуть» переживает перезагрузку',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      if (пакетнаяОболочкаAppShell(конфиг)) return [];
      const весь = всеТексты(конфиг, 'оболочка');
      if (!/localStorage/.test(весь)) return ['во всей оболочке нет localStorage: состояние панели не сохраняется'];
      const кусок = весь.slice(Math.max(0, весь.indexOf('localStorage') - 400), весь.indexOf('localStorage') + 400);
      if (!/try\s*{/.test(кусок)) return ['чтение localStorage без try/catch: приватный режим браузера уронит оболочку'];
      return [];
    },
  },
  {
    имя: 'подпись кнопки меняется по состоянию',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      if (пакетнаяОболочкаAppShell(конфиг)) return [];
      const весь = всеТексты(конфиг, 'оболочка');
      const свернуть = /Свернуть/.test(весь);
      const развернуть = /Развернуть/.test(весь);
      if (!свернуть && !развернуть) return ['кнопки сворачивания панели нет вовсе'];
      if (свернуть && !развернуть) return ['есть «Свернуть», нет «Развернуть»: подпись не зависит от состояния'];
      // «Развернуть» может стоять только в title, а видимая подпись при этом жёсткая.
      // Слова обязаны стоять по обе стороны двоеточия ВНУТРИ выбора, иначе
      // «title={свёрнут ? 'Развернуть' : ''}>Свернуть» прошло бы за настоящий выбор.
      const выбор = строки(весь).some(([, с]) => /\?[^\n}>]*(Свернуть|Развернуть)[^\n}>]*:[^\n}>]*(Свернуть|Развернуть)/.test(с));
      if (!выбор) return ['подпись кнопки не выбирается по состоянию: оба слова есть, но выбора между ними нет'];
      return [];
    },
  },
  {
    имя: 'выход из аккаунта существует и один',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      const беды = [];
      // Точка выхода это место, где выход РЕАЛИЗОВАН: обращение к серверу или к стору.
      // Вызов функции, ПРИШЕДШЕЙ пропом (у Бренд-платформы `onLogout: logout`), точкой
      // не является: он ведёт в ту же единственную реализацию этажом выше.
      const обработчики = new Set();
      for (const ф of конфиг.файлы.оболочка) {
        const всеСтроки = читать(конфиг, ф).split('\n');
        // Имена, за которыми стоит настоящий выход (получены из стора в этом же файле).
        const свои = new Set();
        всеСтроки.forEach(с => {
          const м = с.match(/(?:const|let)\s+([\wа-яё]+)\s*=\s*[^=]*(?:useAuthStore|useAuth|useStore|useSession)\s*\(/iu);
          if (м && /logout|выйти|выход/i.test(с)) свои.add(м[1]);
          // Деструктуризация стора: const { user, logout } = useAuthStore().
          const дес = с.match(/(?:const|let)\s*\{([^}]+)\}\s*=\s*[^=]*(?:useAuthStore|useAuth|useStore|useSession)\s*\(/iu);
          if (дес) дес[1].split(',').map(х => х.trim().split(':').pop().trim())
            .filter(х => /logout|выйти|выход/i.test(х)).forEach(х => свои.add(х));
          // Выход бывает и обычной функцией модуля: import { logout } from "../lib/api".
          const имп = с.match(/^\s*import\s*\{([^}]+)\}\s*from\s*['"][^'"]*(api|auth|session|lib)[^'"]*['"]/i);
          if (имп) имп[1].split(',').map(х => х.trim().split(/\s+as\s+/).pop().trim())
            .filter(х => /logout|выйти|выход/i.test(х)).forEach(х => свои.add(х));
        });
        // Имена, пришедшие пропом: их вызов точкой не считается.
        const чужие = new Set();
        всеСтроки.forEach(с => {
          const м = с.match(/onLogout\s*:\s*([\wа-яё]+)/iu);
          if (м) чужие.add(м[1]);
          if (/^\s*onLogout\s*,/.test(с)) чужие.add('onLogout');
        });
        всеСтроки.forEach((с, i) => {
          if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(с)) return;
          if (/^\s*(export\s+)?(async\s+)?function\s+[\wа-яё]*(logout|выйти)/i.test(с)) return;
          if (/=>\s*s\.\w+|useAuthStore\(|useStore\(|useAuth\(|useSession\(/.test(с)) return;
          const реализация = /\/auth\/logout/.test(с)
            || /(?:authApi|api|http|client)\.?\w*\.?logout\s*\(/i.test(с)
            || [...свои].some(имя => new RegExp(`(?<![\\p{L}])${имя}\\s*\\(`, 'u').test(с));
          if (!реализация) return;
          // Имя, объявленное в этом же файле из стора, остаётся своим, даже если
          // такое же имя где-то принимают пропом: пропом его получает ДРУГОЙ компонент.
          if ([...чужие].some(имя => !свои.has(имя) && new RegExp(`(?<![\\p{L}])${имя}\\s*\\(`, 'u').test(с))) return;
          let владелец = `${ф}:${i + 1}`;
          for (let j = i; j >= 0 && j > i - 40; j--) {
            if (/^\s*(export\s+)?(async\s+)?function\s+[\wа-яё]+|^\s*(export\s+)?(const|let)\s+[\wа-яё]+\s*(:[^=]+)?=\s*(async\s*)?(\([^)]*\)|[\wа-яё]+)\s*=>/i.test(всеСтроки[j])) {
              владелец = `${ф}:${j + 1}:${всеСтроки[j].trim().slice(0, 40)}`;
              break;
            }
          }
          обработчики.add(владелец);
        });
      }
      const точек = обработчики.size;
      беды.push(...обработчики);
      if (точек === 0) return ['в оболочке нет выхода из аккаунта'];
      if (точек > 1) return [`выход вызывается из ${точек} мест: ${беды.join(', ')} — канон требует одну точку`];
      return [];
    },
  },
  {
    имя: 'блок пользователя показывает, под кем человек работает',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      const весь = всеТексты(конфиг, 'оболочка');
      return /user\??\.(name|email)|пользовател/i.test(весь) ? [] : ['в оболочке нет имени пользователя'];
    },
  },
  {
    имя: 'знак нарисован вектором, а не картинкой',
    файлы: 'бренд',
    проверка(текст, путь) {
      const беды = [];
      строки(текст).forEach(([н, с]) => { if (РАСТР.test(с)) беды.push(`${путь}:${н}: растровый знак`); });
      return беды;
    },
  },
  {
    имя: 'цвет в оболочке задан ролью, а не числом',
    файлы: 'оболочка',
    проверка(текст, путь) {
      const беды = [];
      строки(текст).forEach(([н, с]) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(с)) return;
        const найдено = с.match(БЕЗ_ЦВЕТА);
        if (найдено) беды.push(`${путь}:${н}: цвет числом ${найдено.join(' ')}`);
      });
      return беды;
    },
  },
  {
    имя: 'название платформы берётся из конфига, а не из разметки',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      const беды = [];
      for (const ф of [...конфиг.файлы.оболочка, ...конфиг.файлы.бренд]) {
        строки(читать(конфиг, ф)).forEach(([н, с]) => {
          if (с.includes(`"${конфиг.названиеПлатформы}"`) || с.includes(`>${конфиг.названиеПлатформы}<`) || с.includes(`'${конфиг.названиеПлатформы}'`))
            беды.push(`${ф}:${н}: название платформы литералом`);
        });
      }
      return беды;
    },
  },
  {
    имя: 'состав меню объявлен один раз',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      if (!конфиг.файлы.меню?.length) return ['меню не вынесено в свой модуль: канон требует один источник для всех поверхностей'];
      const беды = [];
      const источники = new Set(конфиг.файлы.меню ?? []);
      for (const ф of конфиг.файлы.оболочка) {
        if (источники.has(ф)) continue; // сам источник меню — это первый носитель, а не второй
        const текст = читать(конфиг, ф);
        строки(текст).forEach(([н, с]) => {
          // JSX передаёт готовый состав в AppShell, но не объявляет второй источник.
          if (/\bnavItems=\{\s*[\w.]+\s*\}/.test(с)) return;
          if (/(NAV|МЕНЮ|РАЗДЕЛЫ|navItems|PAGE_TITLES|ЗАГОЛОВКИ)\s*(:\s*[\w<>,\s|'"\[\]]+)?=\s*[\[{]|(NAV|МЕНЮ|РАЗДЕЛЫ|navItems|PAGE_TITLES|ЗАГОЛОВКИ)\s*:\s*[\[{]/.test(с))
            беды.push(`${ф}:${н}: второй носитель состава или заголовков меню`);
        });
      }
      return беды;
    },
  },
  {
    имя: 'порог мобильной ширины общий (768)',
    файлы: 'оболочка',
    общая: true,
    проверка(_т, _п, конфиг) {
      const беды = [];
      const обОболочке = /\.sidebar|\.main\b|\.topbar|aside|\bnav\b|drawer|панел/i;
      for (const ф of [...конфиг.файлы.оболочка, ...конфиг.файлы.стили]) {
        const всеСтроки = читать(конфиг, ф).split('\n');
        всеСтроки.forEach((с, i) => {
          const м = с.match(/max-width:\s*(\d{3,4})px|\(min-width:\s*(\d{3,4})px/);
          const порог = м && Number(м[1] || м[2]);
          if (!порог || порог === 768 || порог === 767 || порог <= 400 || порог >= 1400) return;
          // Смотрим, про оболочку ли этот блок: селекторы внутри следующих строк.
          const блок = всеСтроки.slice(i, i + 12).join('\n');
          if (!обОболочке.test(блок) && !обОболочке.test(с)) return;
          беды.push(`${ф}:${i + 1}: свой порог ${порог}px вместо общего 768`);
        });
      }
      return беды;
    },
  },
  // ── Разделы 11-13 канона 1.1: экран входа, вкладка браузера, карточка ссылки ──
  // Включаются только там, где в конфиге стоит "канонВхода": true. Платформа без
  // этого флага ещё не в области раздела, и молчание здесь — не слепота, а очередь.
  {
    имя: 'экран входа: доля панели 40, форма 400, знак 44',
    файлы: 'вход',
    общая: true,
    // Общая нарочно: у одних платформ геометрия входа живёт в разметке, у других в стилях,
    // и «не задано» надо спрашивать у ВСЕЙ группы файлов входа, а не у каждого по отдельности.
    проверка(_т, _п, конфиг) {
      if (!конфиг.канонВхода) return [];
      const беды = [];
      const группа = конфиг.файлы.входГеометрия ? 'входГеометрия' : 'вход';
      const весь = всеТексты(конфиг, группа);
      const весьВход = `${всеТексты(конфиг, 'вход')}\n${весь}`;
      const путь = (конфиг.файлы[группа] || []).join(', ');
      const пакетнаяОболочка = /from\s+['"]@chirkov\/shell['"]/.test(весьВход)
        && /<LoginShell\b/.test(весьВход);
      строки(весь).forEach(([н, с]) => {
        if (/w-5\/12|w-\[4[1-9]%\]|w-\[3[0-9]%\]|basis-5\/12/.test(с))
          беды.push(`${путь} (строка ${н} объединённого текста): доля тёмной панели не 40% (${с.trim().slice(0, 60)})`);
        if (/max-w-(sm|md|lg|xl)\b/.test(с))
          беды.push(`${путь}:${н}: ширина формы шкалой Tailwind вместо 400 (${с.trim().slice(0, 60)})`);
        if (/size=\{(5[0-9]|[6-9][0-9]|[1-9]\d\d)\}/.test(с) && /Logo|Brand|Знак/i.test(с))
          беды.push(`${путь}:${н}: знак на входе крупнее 44 (${с.trim().slice(0, 60)})`);
      });
      if (!пакетнаяОболочка && !/w-\[40%\]|width:\s*40%/.test(весь)) беды.push(`${путь}: доля тёмной панели 40% не задана`);
      if (!пакетнаяОболочка && !/max-w-\[400px\]|max-width:\s*400px|w-\[400px\]/.test(весь)) беды.push(`${путь}: ширина формы 400 не задана`);
      return беды;
    },
  },
  {
    имя: 'экран входа: надзаголовок над формой есть',
    файлы: 'вход',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const есть = /uppercase-mono|tracking-\[0\.[0-9]+em\]|letter-spacing/.test(текст)
        || /Рабочее пространство|Вход в платформу|Вход для клиента|Восстановление доступа/.test(текст);
      return есть ? [] : [`${путь}: над заголовком формы нет надзаголовка разрядкой (канон 11)`];
    },
  },
  {
    имя: 'экран входа: имя компании одно и из конфига',
    файлы: 'вход',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const беды = [];
      строки(текст).forEach(([н, с]) => {
        if (/Чирков\s*&\s*Партнёр/i.test(с)) беды.push(`${путь}:${н}: имя компании через амперсанд, канон пишет «Чирков и партнёры»`);
        if (/ЧИРКОВ И ПАРТНЕРЫ/.test(с)) беды.push(`${путь}:${н}: имя компании без буквы ё`);
        if (/['"`]Чирков и партнёры['"`]/.test(с)) беды.push(`${путь}:${н}: имя компании литералом, а не из platform.ts`);
      });
      return беды;
    },
  },
  {
    имя: 'вкладка: значок бренда по каноническим путям',
    файлы: 'html',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const беды = [];
      if (!/rel=["']icon["'][^>]*href=["']\/favicon\.svg["']|href=["']\/favicon\.svg["'][^>]*rel=["']icon["']/.test(текст))
        беды.push(`${путь}: значок не подключён по каноническому пути /favicon.svg`);
      if (!/apple-touch-icon/.test(текст)) беды.push(`${путь}: нет apple-touch-icon 180×180`);
      if (!/name=["']theme-color["'][^>]*#B45309|#B45309[^>]*theme-color/i.test(текст))
        беды.push(`${путь}: нет meta theme-color #B45309`);
      return беды;
    },
  },
  {
    имя: 'вкладка: заголовок короткий, без имени компании',
    файлы: 'html',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const m = текст.match(/<title>([^<]*)<\/title>/);
      if (!m) return [`${путь}: нет тега title`];
      const zag = m[1].trim();
      const беды = [];
      if (/Чирков/i.test(zag)) беды.push(`${путь}: в заголовке вкладки имя компании («${zag}»), канон 12 держит там только короткое имя платформы`);
      // Граница слова \b перед кириллицей не срабатывает вовсе: нужен просмотр вперёд по букве.
      if (/ЧиП(?![\p{L}])/u.test(zag)) беды.push(`${путь}: в заголовке вкладки внутреннее сокращение ЧиП («${zag}»)`);
      if (zag.length > 20) беды.push(`${путь}: заголовок вкладки длиннее 20 знаков («${zag}», ${zag.length})`);
      return беды;
    },
  },
  {
    имя: 'вкладка: значок это знак бренда, а не буква',
    файлы: 'значок',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const беды = [];
      if (/<text[\s>]/.test(текст)) беды.push(`${путь}: во значке буква тегом text, канон 12 держит там фирменный знак`);
      if (!/#B45309/i.test(текст)) беды.push(`${путь}: подложка значка не янтарная #B45309`);
      return беды;
    },
  },
  {
    имя: 'карточка ссылки: набор тегов полный',
    файлы: 'html',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const картинкаОбязательна = конфиг.огКартинкаОбязательна !== false;
      const нужно = ['og:title', 'og:description', 'og:site_name', 'og:locale', 'twitter:card'];
      if (картинкаОбязательна) нужно.push('og:image', 'og:image:width', 'og:image:height');
      const нет = нужно.filter(тег => !new RegExp(`["']${тег.replace(/:/g, ':')}["']`).test(текст));
      const беды = нет.length ? [`${путь}: в карточке ссылки нет тегов ${нет.join(', ')}`] : [];
      const ожидаемоеИмя = конфиг.имяКомпании || 'Чирков и партнёры';
      if (/og:site_name["'][^>]*content=["']([^"']*)["']/.test(текст)) {
        const имя = текст.match(/og:site_name["'][^>]*content=["']([^"']*)["']/)[1];
        if (имя !== ожидаемоеИмя) беды.push(`${путь}: og:site_name написан как «${имя}», канон держит «${ожидаемоеИмя}»`);
      }
      return беды;
    },
  },
  {
    имя: 'карточка ссылки: палитра только янтарная и нейтрали',
    файлы: 'карточка',
    проверка(текст, путь, конфиг) {
      if (!конфиг.канонВхода) return [];
      const РАЗРЕШЕНО = new Set([
        '#B45309', '#8F4207', '#773706', '#944407', '#7C3906', '#D16310', '#F4A467',
        '#F1AA74', '#F3C7A5', '#F9E4D4', '#FCF2EB',
        '#FFFFFF', '#FAFAF9', '#F5F5F4', '#E7E5E4', '#D6D3D1', '#A8A29E',
        '#78716C', '#57534E', '#44403C', '#292524', '#1A1A1A', '#242424', '#2A2A2A',
        '#9CA3AF', '#000000', '#FFF', '#000',
      ].map(s => s.toUpperCase()));
      const беды = [];
      строки(текст).forEach(([н, с]) => {
        const найдено = с.match(БЕЗ_ЦВЕТА) || [];
        for (const цвет of найдено) {
          const ц = цвет.toUpperCase();
          if (!РАЗРЕШЕНО.has(ц)) беды.push(`${путь}:${н}: цвет ${цвет} вне янтарной рампы и нейтралей`);
        }
      });
      return беды;
    },
  },
];

function строки(текст) { return текст.split('\n').map((с, i) => [i + 1, с]); }
function читать(конфиг, ф) {
  const п = resolve(конфиг.корень, ф);
  return existsSync(п) ? readFileSync(п, 'utf8') : '';
}
function всеТексты(конфиг, группа) {
  return (конфиг.файлы[группа] || []).map(ф => читать(конфиг, ф)).join('\n');
}

// AppShell целиком владеет шириной, памятью и подписью сворачивания.
function пакетнаяОболочкаAppShell(конфиг) {
  const весь = всеТексты(конфиг, 'оболочка');
  return /import\s*\{[^}]*\bAppShell\b[^}]*\}\s*from\s*['"]@chirkov\/shell['"]/.test(весь)
    && /<AppShell\b/.test(весь);
}

function прогон(конфиг) {
  const нарушения = [];
  for (const правило of ПРАВИЛА) {
    if (правило.общая) {
      нарушения.push(...правило.проверка('', '', конфиг).map(б => [правило.имя, б]));
      continue;
    }
    for (const ф of конфиг.файлы[правило.файлы] || []) {
      const текст = читать(конфиг, ф);
      if (!текст) continue;
      нарушения.push(...правило.проверка(текст, ф, конфиг).map(б => [правило.имя, б]));
    }
  }
  return нарушения;
}

// ── Слом: каждое правило обязано краснеть на заведомо сломанном коде ──────────
if (САМОТЕСТ) {
  const { mkdtempSync, writeFileSync, mkdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const корень = mkdtempSync(join(tmpdir(), 'канон-'));
  mkdirSync(join(корень, 'src'), { recursive: true });
  mkdirSync(join(корень, 'public'), { recursive: true });
  mkdirSync(join(корень, 'scripts'), { recursive: true });
  const положить = (имя, текст) => writeFileSync(join(корень, имя), текст);
  const конфигОк = {
    корень, названиеПлатформы: 'Проба', переменнаяШирины: '--spacing-sidebar',
    файлы: { оболочка: ['src/Layout.tsx', 'src/Sidebar.tsx'], бренд: ['src/Brand.tsx'], стили: ['src/index.css'], меню: ['src/nav.ts'], вход: ['src/Login.tsx'], html: ['index.html'], значок: ['public/favicon.svg'], карточка: ['scripts/og.html'] },
    канонВхода: true,
  };
  const целое = {
    'src/Layout.tsx': `import { NAV } from './nav';
const [свёрнут, свернуть] = useState(() => { try { return localStorage.getItem('x') === '1'; } catch { return false; } });
<button onClick={() => свернуть(!свёрнут)}>{свёрнут ? 'Развернуть' : 'Свернуть'}</button>
<span>{user?.name}</span>
const logout = useAuthStore((s) => s.logout);
<button onClick={() => logout()}>Выйти</button>
<aside style={{ width: 'var(--spacing-sidebar)' }}>{PLATFORM.product}</aside>`,
    'src/Brand.tsx': `export const Brand = () => <svg viewBox="0 0 32 32"><path d={MARK_PATH} fill="currentColor" /></svg>;`,
    'src/index.css': `:root { --spacing-sidebar: 240px; --spacing-sidebar-collapsed: 64px; }
@media (max-width: 768px) { .sidebar { transform: translateX(-100%); } }`,
    'src/nav.ts': `export const NAV = [{ path: '/', title: 'Главная' }];`,
    'src/Sidebar.tsx': `export const Панель = () => null;`,
    'src/Login.tsx': `<div className="hidden lg:flex lg:w-[40%] bg-inverse flex-col justify-between py-12 px-14">
  <BrandLogo size={44} tone="light" />
  <h1>{PLATFORM.product}</h1>
  <p className="font-mono">{PLATFORM.copyright}</p>
</div>
<div className="w-full lg:w-[60%] bg-white flex items-center justify-center p-12">
  <div className="w-full max-w-[400px]">
    <p className="uppercase-mono">Рабочее пространство</p>
    <h2>С возвращением</h2>
  </div>
</div>`,
    'index.html': `<!doctype html><html lang="ru"><head>
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<meta name="theme-color" content="#B45309" />
<title>Проба</title>
<meta property="og:title" content="Обещание платформы" />
<meta property="og:description" content="Одна строка о пользе." />
<meta property="og:image" content="https://app.example.invalid/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:site_name" content="Чирков и партнёры" />
<meta property="og:locale" content="ru_RU" />
<meta name="twitter:card" content="summary_large_image" />
</head><body></body></html>`,
    'public/favicon.svg': `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#B45309"/><path d="M10 10" fill="#FFFFFF"/></svg>`,
    'scripts/og.html': `<body style="background:#1A1A1A;color:#FFFFFF"><span style="color:#F4A467">чип</span></body>`,
  };
  for (const [ф, т] of Object.entries(целое)) положить(ф, т);

  const базовые = прогон(конфигОк);
  if (базовые.length) {
    console.error('САМОТЕСТ ПРОВАЛЕН: здоровый образец признан нарушителем:');
    базовые.forEach(([п, б]) => console.error(`  ${п}: ${б}`));
    process.exit(1);
  }

  const поломки = [
    ['ширина панели задана переменной, а не числом', 'src/Layout.tsx', т => т.replace("width: 'var(--spacing-sidebar)'", 'width: 240')],
    ['выбор «свернуть» переживает перезагрузку', 'src/Layout.tsx', т => т.replace(/try \{ return localStorage[^}]+\} catch \{ return false; \}/, 'false')],
    ['подпись кнопки меняется по состоянию', 'src/Layout.tsx', т => т.replace("{свёрнут ? 'Развернуть' : 'Свернуть'}", 'Свернуть')],
    ['выход из аккаунта существует и один', 'src/Layout.tsx', т => т + `\n<button onClick={() => logout()}>Выйти</button>`],
    ['блок пользователя показывает, под кем человек работает', 'src/Layout.tsx', т => т.replace('<span>{user?.name}</span>', '<span>—</span>')],
    ['знак нарисован вектором, а не картинкой', 'src/Brand.tsx', () => `export const Brand = () => <img src="/logo-mark-dark.png" />;`],
    ['цвет в оболочке задан ролью, а не числом', 'src/Layout.tsx', т => т + `\n<div style={{ background: '#1A1A1A' }} />`],
    ['название платформы берётся из конфига, а не из разметки', 'src/Layout.tsx', т => т.replace('{PLATFORM.product}', '"Проба"')],
    ['состав меню объявлен один раз', 'src/Layout.tsx', т => т + `\nconst PAGE_TITLES = { '/': 'Главная' };`],
    ['состав меню объявлен один раз', 'src/Layout.tsx', т => т + `\nconst PAGE_TITLES: Record<string, string> = { '/': 'Главная' };`],
    ['подпись кнопки меняется по состоянию', 'src/Layout.tsx', т => т.replace("{свёрнут ? 'Развернуть' : 'Свернуть'}", "title={свёрнут ? 'Развернуть' : ''}>Свернуть")],
    ['выход из аккаунта существует и один', 'src/Layout.tsx', т => т + `\nconst второйВыход = async () => { await authApi.logout(); };\n<button onClick={второйВыход}>Выйти</button>`],
    ['порог мобильной ширины общий (768)', 'src/index.css', т => т.replace('768px', '1024px')],
  ];
  // Законные конструкции, на которых замок обязан МОЛЧАТЬ (ложный блок приучает себя игнорировать).
  const законные = [
    ['получение функции выхода из стора', 'src/Layout.tsx', т => т.replace('<button onClick={() => logout()}>Выйти</button>', 'const logoutStore = useAuthStore((s) => s.logout);\n<button onClick={() => logoutStore()}>Выйти</button>')],
    ['подпись в aria-label с пояснением', 'src/Layout.tsx', т => т.replace("{свёрнут ? 'Развернуть' : 'Свернуть'}", "aria-label={свёрнут ? 'Развернуть разделы брифа' : 'Свернуть разделы брифа'}")],
    ['объявление состава меню в своём модуле', 'src/nav.ts', т => т + `\nexport const PAGE_TITLES: Record<string, string> = { '/': 'Главная' };`],
    ['два вызова внутри одного обработчика выхода', 'src/Layout.tsx', т => т.replace('<button onClick={() => logout()}>Выйти</button>', 'const handleLogout = async () => {\n  await authApi.logout();\n  logout();\n};\n<button onClick={handleLogout}>Выйти</button>')],
    ['медиазапрос про кегль, а не про оболочку', 'src/index.css', т => т + `\n@media (max-width: 700px) { .kicker { letter-spacing: 0.02em; } }`],
    ['комментарий про единственную точку выхода', 'src/Layout.tsx', т => т.replace('<button onClick={() => logout()}>Выйти</button>', '{/* logout ТОЛЬКО тут, ровно одна точка выхода */}\n<button onClick={() => logout()}>Выйти</button>')],
    ['компонент кнопки выхода без своего вызова', 'src/Layout.tsx', т => т + `\nfunction LogoutButton({ onClick, label }: { onClick: () => void; label: string }) { return <button onClick={onClick}>{label}</button>; }`],
    ['вызов обработчика, пришедшего пропом', 'src/Sidebar.tsx', () => `function Sidebar({ onLogout: logout }: { onLogout: () => void }) { return <button onClick={() => logout()}>Выйти</button>; }`],
  ];
  // Ещё один слом: выход, импортированный из модуля api, тоже обязан считаться точкой.
  поломки.push(['выход из аккаунта существует и один', 'src/Sidebar.tsx', () => `import { logout } from "../lib/api";\nconst выйтиОтсюда = async () => { await logout(); };\n<button onClick={выйтиОтсюда}>Выйти</button>`]);
  // Разделы 11-13: вход, вкладка, карточка
  поломки.push(['экран входа: доля панели 40, форма 400, знак 44', 'src/Login.tsx', т => т.replace('lg:w-[40%]', 'md:w-5/12')]);
  поломки.push(['экран входа: доля панели 40, форма 400, знак 44', 'src/Login.tsx', т => т.replace('max-w-[400px]', 'max-w-sm')]);
  поломки.push(['экран входа: доля панели 40, форма 400, знак 44', 'src/Login.tsx', т => т.replace('size={44}', 'size={56}')]);
  поломки.push(['экран входа: надзаголовок над формой есть', 'src/Login.tsx', т => т.replace('<p className="uppercase-mono">Рабочее пространство</p>', '')]);
  поломки.push(['экран входа: имя компании одно и из конфига', 'src/Login.tsx', т => т + `\n<h1>Чирков & Партнёры</h1>`]);
  поломки.push(['экран входа: имя компании одно и из конфига', 'src/Login.tsx', т => т + `\n<span>{'Чирков и партнёры'}</span>`]);
  поломки.push(['вкладка: значок бренда по каноническим путям', 'index.html', т => т.replace('href="/favicon.svg"', 'href="/brand/favicon.svg"')]);
  поломки.push(['вкладка: значок бренда по каноническим путям', 'index.html', т => т.replace(/<link rel="apple-touch-icon"[^>]*>/, '')]);
  поломки.push(['вкладка: значок бренда по каноническим путям', 'index.html', т => т.replace(/<meta name="theme-color"[^>]*>/, '')]);
  поломки.push(['вкладка: заголовок короткий, без имени компании', 'index.html', т => т.replace('<title>Проба</title>', '<title>Диагностика, Чирков и партнёры</title>')]);
  поломки.push(['вкладка: заголовок короткий, без имени компании', 'index.html', т => т.replace('<title>Проба</title>', '<title>Бренд-платформа ЧиП</title>')]);
  поломки.push(['вкладка: значок это знак бренда, а не буква', 'public/favicon.svg', () => `<svg viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#B45309"/><text x="32" y="45">Д</text></svg>`]);
  поломки.push(['карточка ссылки: набор тегов полный', 'index.html', т => т.replace(/<meta property="og:image:width"[^>]*>/, '')]);
  поломки.push(['карточка ссылки: набор тегов полный', 'index.html', т => т.replace('content="Чирков и партнёры"', 'content="Чирков и Партнёры"')]);
  поломки.push(['карточка ссылки: палитра только янтарная и нейтрали', 'scripts/og.html', т => т.replace('#F4A467', '#E8FF00')]);
  // Законные конструкции разделов 11-13
  законные.push(['публичная воронка зовёт вход по-своему', 'src/Login.tsx', т => т.replace('Рабочее пространство', 'Вход для клиента').replace('С возвращением', 'Добро пожаловать')]);
  законные.push(['знак меньше вилки канона', 'src/Login.tsx', т => т.replace('size={44}', 'size={36}')]);
  законные.push(['нейтральный серый в кадре карточки', 'scripts/og.html', т => т.replace('#F4A467', '#9CA3AF')]);
  законные.push(['короткое имя платформы в заголовке вкладки', 'index.html', т => т.replace('<title>Проба</title>', '<title>Работа над ошибками</title>')]);

  поломки.push(['выход из аккаунта существует и один', 'src/Sidebar.tsx', () => `const { user, logout } = useAuthStore();\nconst уйти = async () => { await logout(); };\n<button onClick={уйти}>Выйти</button>`]);


  let провалов = 0;
  for (const [имя, файл, ломать] of поломки) {
    положить(файл, ломать(целое[файл]));
    const найдено = прогон(конфигОк).some(([п]) => п === имя);
    положить(файл, целое[файл]);
    console.log(`${найдено ? '  ✓' : '  ✗'} ${имя}`);
    if (!найдено) провалов++;
  }
  for (const [имя, файл, менять] of законные) {
    положить(файл, менять(целое[файл]));
    const шум = прогон(конфигОк);
    положить(файл, целое[файл]);
    console.log(`${шум.length ? '  ✗' : '  ✓'} молчит: ${имя}${шум.length ? ' — ЛОЖНЫЙ БЛОК: ' + шум.map(([п, б]) => `${п} (${б})`).join('; ') : ''}`);
    if (шум.length) провалов++;
  }
  console.log(провалов ? `САМОТЕСТ ПРОВАЛЕН: ошибок ${провалов} из ${поломки.length + законные.length}` : `Самотест пройден: ${поломки.length} правил краснеют на сломе, ${законные.length} законных конструкций не вызывают ложного блока.`);
  process.exit(провалов ? 1 : 0);
}

// ── Рабочий прогон ───────────────────────────────────────────────────────────
const индексКонфига = process.argv.indexOf('--конфиг');
if (индексКонфига < 0 || !process.argv[индексКонфига + 1]) {
  console.error('Передайте конфиг: --конфиг <путь к оболочка-канон.json>.');
  process.exit(1);
}
const путьКонфига = resolve(process.cwd(), process.argv[индексКонфига + 1]);
if (!existsSync(путьКонфига)) {
  console.error(`Нет конфига оболочки: ${путьКонфига}`);
  process.exit(1);
}
const конфиг = JSON.parse(readFileSync(путьКонфига, 'utf8'));
конфиг.корень = resolve(dirname(путьКонфига), конфиг.корень ?? '..');

const нарушения = прогон(конфиг);
if (!нарушения.length) {
  console.log(`Канон оболочки 1.1: нарушений нет (проверено правил ${ПРАВИЛА.length}).`);
  process.exit(0);
}
console.error(`Канон оболочки 1.1 нарушен, мест ${нарушения.length}:`);
for (const [правило, беда] of нарушения) console.error(`  · ${правило}\n      ${беда}`);
console.error('\nЧто читать: «Дизайн-система платформ/08 Общие элементы/КАНОН-ОБОЛОЧКИ.md».');
process.exit(1);
