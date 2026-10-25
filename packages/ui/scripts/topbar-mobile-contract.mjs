import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

function mobileActions(css) {
  const match = css.match(/\.chip-shell\[data-mobile='true'\] \.chip-topbar__actions\s*\{([^}]*)\}/);
  if (!match) throw new Error('Не найдено мобильное правило действий TopBar');
  return match[1];
}

function assertContract(css) {
  const declarations = mobileActions(css);
  if (/width\s*:\s*100%/.test(declarations)) {
    throw new Error('Действия TopBar снова принудительно занимают отдельную строку');
  }
  if (!/width\s*:\s*auto/.test(declarations)) {
    throw new Error('Мобильным действиям TopBar нужна собственная ширина');
  }
  if (!/margin-left\s*:\s*auto/.test(declarations)) {
    throw new Error('Мобильные действия TopBar не прижаты к правому краю');
  }
  const leading = css.match(/\.chip-shell\[data-mobile='true'\] \.chip-topbar__leading\s*\{([^}]*)\}/)?.[1] ?? '';
  if (!/flex-basis\s*:\s*0/.test(leading)) {
    throw new Error('Заголовок TopBar не освобождает место действиям');
  }
  if (!/min-width\s*:\s*calc\(/.test(leading)) {
    throw new Error('Действия TopBar могут вытеснить заголовок и кнопку меню');
  }
  const description = css.match(/\.chip-topbar__description\s*\{([^}]*)\}/)?.[1] ?? '';
  if (/white-space\s*:\s*nowrap/.test(description)) {
    throw new Error('Описание TopBar снова запрещает перенос строк');
  }
  if (!/white-space\s*:\s*normal/.test(description)) {
    throw new Error('Описание TopBar должно переноситься по словам на любой ширине');
  }
}

if (process.argv.includes('--selftest')) {
  const leading = ".chip-shell[data-mobile='true'] .chip-topbar__leading { min-width: calc(var(--chip-touch-target) + var(--chip-space-12)); flex-basis: 0; }";
  const broken = `${leading} .chip-shell[data-mobile='true'] .chip-topbar__actions { width: 100%; } .chip-topbar__description { white-space: normal; }`;
  const valid = `${leading} .chip-shell[data-mobile='true'] .chip-topbar__actions { width: auto; margin-left: auto; } .chip-topbar__description { white-space: normal; }`;
  let caught = false;
  try {
    assertContract(broken);
  } catch (error) {
    caught = String(error).includes('отдельную строку');
  }
  if (!caught) throw new Error('Слом width: 100% не пойман');
  assertContract(valid);
  let descriptionCaught = false;
  try {
    assertContract(`${leading} .chip-shell[data-mobile='true'] .chip-topbar__actions { width: auto; margin-left: auto; } .chip-topbar__description { white-space: nowrap; }`);
  } catch (error) {
    descriptionCaught = String(error).includes('запрещает перенос');
  }
  if (!descriptionCaught) throw new Error('Слом nowrap у описания TopBar не пойман');
  console.log('Слом TopBar пойман: width: 100% возвращать нельзя.');
} else {
  assertContract(readFileSync(resolve(root, 'src/styles.css'), 'utf8'));
  console.log('TopBar на телефоне: естественный перенос действий сохранён.');
}
