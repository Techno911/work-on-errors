import { extendTailwindMerge } from 'tailwind-merge';
import { designRoles } from './design-roles.generated.js';

/**
 * Ролевые имена Tailwind v4 из словаря пакета @chirkov/shell/theme.css.
 *
 * tailwind-merge 2.x не читает CSS-тему Tailwind v4. Без явной карты он
 * принимает любой неизвестный `text-*` за цвет, `shadow-*` — за цвет тени,
 * а смысловые радиусы вовсе не считает одной группой. В результате классы
 * разных CSS-свойств схлопываются, а классы одного свойства иногда остаются
 * вместе и побеждают по случайному порядку сгенерированного CSS.
 *
 * Список читает не этот файл (он собирается в браузерный бандл, где нет
 * node:fs/node:module), а scripts/generate-design-roles.mjs — результат
 * лежит в design-roles.generated.js. Второй копии словаря здесь больше нет:
 * до 23.09.2026 такая копия отставала от index.css и роняла сборку при
 * каждом переименовании роли.
 */
export { designRoles };

const radiusGroups = Object.fromEntries(
  ['', 's', 'e', 't', 'r', 'b', 'l', 'ss', 'se', 'ee', 'es', 'tl', 'tr', 'br', 'bl']
    .map((side) => {
      const id = side ? `rounded-${side}` : 'rounded';
      const prefix = side ? `rounded-${side}` : 'rounded';
      return [id, [{ [prefix]: designRoles.radius }]];
    }),
);

const borderColorGroups = Object.fromEntries(
  ['', 'x', 'y', 's', 'e', 't', 'r', 'b', 'l'].map((side) => {
    const id = side ? `border-color-${side}` : 'border-color';
    const prefix = side ? `border-${side}` : 'border';
    return [id, [{ [prefix]: designRoles.color }]];
  }),
);

export const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: designRoles.fontSize }],
      'text-color': [{ text: designRoles.color }],
      'bg-color': [{ bg: designRoles.color }],
      ...radiusGroups,
      ...borderColorGroups,
      'divide-color': [{ divide: designRoles.color }],
      'outline-color': [{ outline: designRoles.color }],
      'ring-color': [{ ring: designRoles.color }],
      'ring-offset-color': [{ 'ring-offset': designRoles.color }],
      shadow: [{ shadow: designRoles.shadow }],
      fill: [{ fill: designRoles.color }],
      'stroke-color': [{ stroke: designRoles.color }],
    },
  },
});
