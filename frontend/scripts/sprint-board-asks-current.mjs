#!/usr/bin/env node
/**
 * Гейт: доска спринта обязана спрашивать текущую неделю ВСЕГДА.
 *
 * Неделя заводится лениво, первым обращением к /sprints/current: пока никто не открыл
 * доску обычным путём, спринта новой недели в базе нет вовсе. До 24.08.2026 страница
 * спрашивала current ТОЛЬКО когда в адресе не было идентификатора спринта, и человек,
 * оставшийся на прошлой неделе (перешёл стрелкой «Пред.» или из «записи ждут в другом
 * спринте»), попадал в замкнутый круг: адрес /sprint/<id прошлой недели> грузит ту же
 * неделю, новая не заводится, стрелка «След.» серая, потому что следующего спринта нет.
 *
 * Ровно это случилось у РОПа одного клиента: «новая неделя не активирована», обновлял
 * несколько раз за день, не помогало. Неделя завелась в 15:16 по Москве, когда доску
 * открыл менеджер, зашедший из меню, и только тогда у РОПа «всё обновилось».
 *
 * Замок держит три вещи: current спрашивается безусловно, список спринтов берётся ПОСЛЕ
 * него (иначе только что заведённая неделя в список не попадёт и навигация вперёд снова
 * окажется закрытой), и у человека есть прямая кнопка выхода к идущей неделе.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './gate-shared.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const PAGE = join(SRC, 'pages', 'SprintBoardPage.tsx');
const HEADER = join(SRC, 'components', 'sprint', 'SprintHeader.tsx');

const page = stripComments(readFileSync(PAGE, 'utf8'));
const header = stripComments(readFileSync(HEADER, 'utf8'));
const problems = [];

// 1. current спрашивается безусловно, а не только в ветке «адрес без идентификатора».
//    Условный вызов внутри тернарника (id ? getById : getCurrent) под это не подходит.
const currentCalls = [...page.matchAll(/sprintsApi\.getCurrent\(/g)];
if (currentCalls.length === 0) {
  console.error('\n✗ sprint-board-asks-current: вызовов sprintsApi.getCurrent на доске не найдено вовсе.');
  console.error('  Метод переименовали или перенесли — обновите гейт, иначе он слеп.\n');
  process.exit(1);
}
const unconditional = currentCalls.some(m => {
  const before = page.slice(Math.max(0, m.index - 120), m.index);
  // Ветка тернарника выглядит как «… ? sprintsApi.getById(id) : sprintsApi.getCurrent(…)».
  return !/\?[^?]*:\s*$/.test(before);
});
if (!unconditional) {
  problems.push(
    'текущая неделя запрашивается только когда в адресе нет спринта: человек на прошлой '
    + 'неделе не заведёт новую, сколько бы ни обновлял страницу',
  );
}

// 2. Список спринтов берётся после current, иначе новая неделя в него не попадёт (гонка).
const listCall = page.search(/sprintsApi\.getList\(/);
const promiseAll = page.search(/await Promise\.all\(\[/);
if (listCall !== -1 && promiseAll !== -1) {
  const inParallelBlock = page.slice(promiseAll, page.indexOf(']);', promiseAll));
  if (/sprintsApi\.getList\(/.test(inParallelBlock)) {
    problems.push(
      'список спринтов запрашивается параллельно с текущей неделей: только что заведённая '
      + 'неделя в список не попадёт и стрелка «След.» останется серой',
    );
  }
}

// 3. Прямой выход к идущей неделе: серая стрелка объяснением не является.
if (!/onGoCurrent/.test(header)) {
  problems.push('в шапке доски нет кнопки выхода к текущей неделе (onGoCurrent)');
}
if (!/onGoCurrent=\{/.test(page)) {
  problems.push('страница доски не передаёт шапке выход к текущей неделе (onGoCurrent)');
}

if (problems.length) {
  console.error('\n✗ Доска спринта может застрять на прошлой неделе.');
  for (const p of problems) console.error('  · ' + p);
  console.error('');
  process.exit(1);
}

console.log('✓ sprint-board-asks-current: текущая неделя спрашивается всегда, выход к ней виден');
