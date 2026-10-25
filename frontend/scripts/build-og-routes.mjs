// Отдельная OG-карточка для страниц, которые уходят человеку в мессенджер.
//
// Ссылку на подключение CRM трекер кидает администратору портала в рабочий чат, и первое,
// что тот видит, — превью. Общее превью платформы («Продажи больше не чёрный ящик») там
// не объясняет ничего: человек не понимает, что от него хотят и сколько это займёт.
// SPA отдаёт один index.html на все маршруты, поэтому мета-теги не могут зависеть от пути.
// Решение: после сборки кладём рядом копию index.html с другими мета-тегами (ассеты те же,
// хэши те же), а nginx отдаёт её на /crm-setup/*. Копия собирается ИЗ index.html, а не
// пишется руками, иначе разъедется с ним при первой же правке шапки.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const APP_URL = process.env.APP_URL || 'https://app.example.invalid';

/** Страницы с собственной карточкой: файл в dist + мета-теги. */
const ROUTES = [
  {
    file: 'crm-setup.html',
    title: 'Подключение CRM · Работа над ошибками',
    description: 'Три шага, около пяти минут, один раз. После подключения записи звонков будут подтягиваться в платформу сами, без ручной загрузки файлов. Нужны права администратора портала; вход в платформу не потребуется.',
    ogTitle: 'Подключение CRM: три шага, около пяти минут',
    image: null,
    url: `${APP_URL}/crm-setup/`,
  },
];

const index = readFileSync(join(DIST, 'index.html'), 'utf8');

for (const r of ROUTES) {
  let html = index
    .replace(/<title>[^<]*<\/title>/, `<title>${r.title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${r.description}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${r.url}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${r.ogTitle}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${r.description}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, r.image ? `$1${r.image}$2` : '$1$2')
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${r.ogTitle}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${r.description}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, r.image ? `$1${r.image}$2` : '$1$2');

  // Подмена обязана СРАБОТАТЬ: молча отданная копия с общими мета-тегами — это ровно тот
  // дефект, ради которого файл существует, и заметить его можно только в чужом мессенджере.
  const марки = [r.url, r.ogTitle, r.title].filter(Boolean);
  if (html === index || !марки.every(m => html.includes(m))) {
    console.error(`[og-routes] мета-теги не подменились для ${r.file}: проверьте шапку index.html`);
    process.exit(1);
  }
  writeFileSync(join(DIST, r.file), html);
  console.log(`[og-routes] ${r.file} — своя OG-карточка`);
}
