// Выгрузка переменных библиотеки «ЧиП · Оболочка платформ» (файл 2PtSVLWHgzsZx07kSV5jhO).
// Запускается целиком как код инструмента use_figma в этом файле; результат сохраняется
// в tokens/figma.json без правок руками. Это КОНТРАКТ между Figma и пакетом:
// scripts/tokens-build.mjs читает ровно этот формат.
//
// Формат результата:
// {
//   "файл": "2PtSVLWHgzsZx07kSV5jhO",
//   "переменные": [
//     { "коллекция": "01 Примитивы", "имя": "Палитра/янтарь/base", "тип": "COLOR" | "FLOAT" | "STRING",
//       "css": "--chip-color-amber-base",          // из codeSyntax.WEB, без var( )
//       "значение": "#b45309" | "#ffffff26" | 13 | "Inter",   // цвет — hex, альфа восьмой парой
//       "ссылка": null | "--chip-color-ink-900",   // если значение — алиас на другую переменную
//       "значенияРежимов": {                  // только у многорежимной коллекции
//         "Широкий": { "значение": 19, "ссылка": null },
//         "Узкий": { "значение": 16, "ссылка": null }
//       },
//       "описание": "..." }
//   ]
// }
// Переменные сортируются по коллекции и имени, чтобы выгрузка давала стабильный diff.

const hex2 = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
const вHex = (c) => '#' + hex2(c.r) + hex2(c.g) + hex2(c.b) + (c.a === undefined || c.a >= 0.999 ? '' : hex2(c.a));
const roundFloat = (value) => Math.round(value * 10000) / 10000;
const css = (v) => {
  const w = (v.codeSyntax && v.codeSyntax.WEB) || '';
  const m = w.match(/^var\((--[\w-]+)\)$/);
  return m ? m[1] : (w || null);
};

const коллекции = await figma.variables.getLocalVariableCollectionsAsync();
const поId = new Map();
for (const к of коллекции) {
  for (const id of к.variableIds) {
    const v = await figma.variables.getVariableByIdAsync(id);
    if (v) поId.set(id, { v, к });
  }
}
const разобрать = async (v, сырое) => {
  let значение = null, ссылка = null;
  if (сырое && typeof сырое === 'object' && сырое.type === 'VARIABLE_ALIAS') {
    const цель = поId.get(сырое.id) || { v: await figma.variables.getVariableByIdAsync(сырое.id) };
    ссылка = цель.v ? css(цель.v) : null;
  } else if (v.resolvedType === 'COLOR') {
    значение = вHex(сырое);
  } else {
    значение = v.resolvedType === 'FLOAT' ? roundFloat(сырое) : сырое;
  }
  return { значение, ссылка };
};
const переменные = [];
for (const { v, к } of поId.values()) {
  const { значение, ссылка } = await разобрать(v, v.valuesByMode[к.defaultModeId]);
  let значенияРежимов;
  if (к.modes.length > 1) {
    значенияРежимов = {};
    for (const режим of к.modes) {
      значенияРежимов[режим.name] = await разобрать(v, v.valuesByMode[режим.modeId]);
    }
  }
  переменные.push({
    коллекция: к.name, имя: v.name, тип: v.resolvedType, css: css(v),
    значение, ссылка, ...(значенияРежимов ? { значенияРежимов } : {}), описание: v.description || '',
  });
}
переменные.sort((a, b) => (a.коллекция + '/' + a.имя).localeCompare(b.коллекция + '/' + b.имя));
return { файл: figma.fileKey, переменные };
